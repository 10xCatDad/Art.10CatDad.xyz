import { test, expect, type Page } from "@playwright/test";
import sharp from "sharp";

const origin = process.env.ART_TEST_ORIGIN || "http://127.0.0.1:5187";
async function pasteFiles(page: Page, bytes: number[], target = "body", count = 1) {
 return page.evaluate(({ bytes, target, count }) => {
  const data = new DataTransfer();
  for (let i = 0; i < count; i++) data.items.add(new File([new Uint8Array(bytes)], `clipboard-${i}.png`, { type: "image/png" }));
  const event = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true, composed: true });
  document.querySelector(target)!.dispatchEvent(event);
  return event.defaultPrevented;
 }, { bytes, target, count });
}

test("native clipboard image paste uploads through the normal metadata-cleaning flow", async ({ page, context, request }) => {
 expect(new URL(origin).hostname).toBe("127.0.0.1");
 await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
 const marker = "PRIVATE_PASTED_IMAGE_METADATA";
 const fixture = await sharp({ create: { width: 128, height: 96, channels: 3, background: "#7d59b1" } }).withExif({ IFD0: { Artist: marker } }).png().toBuffer();
 await page.goto("/signin-with-chatgpt?return_to=/manage");
 await expect(page.getByLabel("Choose images to upload")).toBeEnabled();
 try {
  await page.evaluate(async bytes => {
   await navigator.clipboard.write([new ClipboardItem({ "image/png": new Blob([new Uint8Array(bytes)], { type: "image/png" }) })]);
   document.addEventListener("paste", event => { document.body.dataset.nativePaste = String(event.isTrusted); }, { once: true });
  }, [...fixture]);
  await page.getByRole("heading", { name: "Manage gallery", exact: true }).click();
  await page.keyboard.press("Control+v");
  await expect(page.locator("body")).toHaveAttribute("data-native-paste", "true");
  await expect(page.getByText("1 of 1 uploaded", { exact: true })).toBeVisible();
  const listing = await (await request.get("/api/images")).json();
  expect(listing.total).toBe(1);
  expect(listing.items[0].title).toBe("Untitled");
  for (const variant of ["original", "thumbnail"]) {
   const bytes = await (await request.get(`/media/${listing.items[0].id}/${variant}`)).body();
   expect(bytes.includes(Buffer.from(marker))).toBe(false);
   const metadata = await sharp(bytes).metadata();
   expect(metadata.exif).toBeUndefined(); expect(metadata.width).toBe(128); expect(metadata.height).toBe(96);
  }
  await page.screenshot({ path: "outputs/gallery-paste-upload.png", fullPage: true });
 } finally {
  const listing = await (await request.get("/api/images")).json();
  for (const item of listing.items) await page.request.delete(`/api/images/${item.id}`, { headers: { origin } });
 }
});

test("pasting preserves editing and access boundaries, and cannot replace an active upload", async ({ page, context, request }) => {
 const fixture = [...await sharp({ create: { width: 48, height: 32, channels: 3, background: "#7d59b1" } }).withExif({ IFD0: { Artist: "PRIVATE_CLIPBOARD_EXIF" } }).png().toBuffer()];
 let starts = 0;
 page.on("request", request => { if (request.method() === "POST" && request.url() === `${origin}/api/uploads`) starts++; });
 await page.goto("/");
 await expect(page.getByLabel("Search images")).toBeEnabled();
 expect(await pasteFiles(page, fixture)).toBe(false); expect(starts).toBe(0);
 await page.goto("/signin-with-chatgpt?return_to=/manage");
 await expect(page.getByLabel("Choose images to upload")).toBeEnabled();
 expect(await pasteFiles(page, fixture, 'input[aria-label="Search images"]')).toBe(false);
 await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
 await page.evaluate(() => navigator.clipboard.writeText("ordinary search text"));
 await page.getByLabel("Search images").focus(); await page.keyboard.press("Control+v");
 await expect(page.getByLabel("Search images")).toHaveValue("ordinary search text");
 await page.getByLabel("Search images").fill("");
 await page.evaluate(() => { const input = document.createElement("div"); input.id = "editable-paste-test"; input.contentEditable = "true"; document.body.appendChild(input); });
 expect(await pasteFiles(page, fixture, "#editable-paste-test")).toBe(false);
 await page.locator("#editable-paste-test").evaluate(element => element.remove());
 expect(starts).toBe(0);
 let release!: () => void;
 const waiting = new Promise<void>(resolve => { release = resolve; });
 await page.route("**/api/uploads", async route => { await waiting; await route.continue(); });
 try {
  expect(await pasteFiles(page, fixture, "body", 2)).toBe(true);
  await expect(page.locator(".queue-row")).toHaveCount(2);
  expect(await pasteFiles(page, fixture)).toBe(true);
  await expect(page.getByRole("status")).toHaveText("Finish the current upload, then paste again.");
  await expect(page.locator(".queue-row")).toHaveCount(2);
  release();
  await expect(page.getByText("2 of 2 uploaded", { exact: true })).toBeVisible();
  expect(starts).toBe(2);
  const listing = await (await request.get("/api/images")).json(); expect(listing.total).toBe(2);
  for (const item of listing.items) {
   const bytes = await (await request.get(`/media/${item.id}/original`)).body();
   expect(bytes.includes(Buffer.from("PRIVATE_CLIPBOARD_EXIF"))).toBe(false);
   expect((await sharp(bytes).metadata()).exif).toBeUndefined();
  }
  await page.getByRole("button", { name: "Edit Untitled", exact: true }).first().click();
  expect(await pasteFiles(page, fixture, 'input[name="title"]')).toBe(false);
  expect(await pasteFiles(page, fixture, "body")).toBe(false);
  expect(starts).toBe(2);
  await page.getByRole("button", { name: "Close editor", exact: true }).click();
  await page.getByRole("link", { name: "View gallery", exact: true }).click();
  await expect(page.getByLabel("Search images")).toBeEnabled();
  expect(await pasteFiles(page, fixture)).toBe(false); expect(starts).toBe(2);
 } finally {
  release(); await page.unroute("**/api/uploads");
  const listing = await (await request.get("/api/images")).json();
  for (const item of listing.items) await page.request.delete(`/api/images/${item.id}`, { headers: { origin } });
 }
});
