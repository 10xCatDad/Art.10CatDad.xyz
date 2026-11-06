import { test, expect } from "@playwright/test";
import sharp from "sharp";
const origin = process.env.ART_TEST_ORIGIN || "http://127.0.0.1:5187";
const workerHeaders = { authorization: `Bearer ${process.env.TAGGER_TOKEN || ""}` };

test("private tag queue, review before saving, and native logout", async ({ page, request }) => {
 test.skip(!process.env.TAGGER_TOKEN, "Set the local worker token to exercise tagging.");
 expect(new URL(origin).hostname).toBe("127.0.0.1");
 const emptyId = "00000000-0000-4000-8000-000000000000";
 expect((await request.get(`/api/images/${emptyId}/tags`)).status()).toBe(403);
 expect((await request.post(`/api/images/${emptyId}/tags`, { headers: { origin } })).status()).toBe(403);
 expect((await request.post("/api/tagger/next")).status()).toBe(401);
 await page.goto("/signin-with-chatgpt?return_to=/manage");
 await expect(page.getByLabel("Choose images to upload")).toBeEnabled();
 const fixture = await sharp({ create: { width: 128, height: 96, channels: 3, background: "#9555ac" } }).png().toBuffer();
 await page.getByLabel("Choose images to upload").setInputFiles([{ name: "local-tag-test.png", mimeType: "image/png", buffer: fixture }]);
 await expect(page.getByText("1 of 1 uploaded")).toBeVisible({ timeout: 30000 });
 const listing = await (await request.get("/api/images")).json();
 const id = listing.items[0].id;
 const ownerPost = (path: string, data?: unknown) => page.request.post(path, { headers: { origin }, data });
 try {
  // A fresh local server reports offline; a previous test heartbeat may still be fresh.
  expect([503, 202]).toContain((await ownerPost(`/api/images/${id}/tags`)).status());
  expect((await request.post("/api/tagger/heartbeat", { headers: workerHeaders })).status()).toBe(200);
  await page.getByRole("button", { name: "Edit Untitled", exact: true }).click();
  await page.getByLabel("Tags", { exact: true }).fill("My custom tag");
  await page.getByRole("button", { name: "Generate tags", exact: true }).click();
  await expect.poll(async () => (await (await page.request.get(`/api/images/${id}/tags`)).json()).state).toBe("pending");
  expect((await ownerPost(`/api/images/${id}/tags`)).status()).toBe(202);
  const { job } = await (await request.post("/api/tagger/next", { headers: workerHeaders })).json();
  expect(job.id).toBe(id);
  expect((await (await request.post("/api/tagger/next", { headers: workerHeaders })).json()).job).toBeNull();
  const state = await (await page.request.get(`/api/images/${id}/tags`)).json();
  expect(state).not.toHaveProperty("lease");
  const complete = (data: unknown) => request.post("/api/tagger/complete", { headers: workerHeaders, data });
  expect((await complete({ id, lease: emptyId, tags: ["violet"] })).status()).toBe(409);
  expect((await complete({ id, lease: job.lease, tags: ["https://private.invalid"] })).status()).toBe(400);
  expect((await complete({ id, lease: job.lease, tags: ["violet", "abstract"] })).status()).toBe(200);
  expect((await complete({ id, lease: job.lease, tags: ["violet", "abstract"] })).status()).toBe(200);
  await expect(page.getByLabel("Tags", { exact: true })).toHaveValue("My custom tag, violet, abstract");
  await expect(page.getByRole("status")).toHaveText("Tags added. Review, then save.");
  expect((await (await request.get(`/api/images/${id}`)).json()).tags).toBe("");
  await page.screenshot({ path: "outputs/gallery-tag-review.png" });
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Edit image" })).not.toBeVisible();
  expect((await (await request.get(`/api/images/${id}`)).json()).tags).toBe("My custom tag, violet, abstract");
  await page.getByRole("link", { name: "Log out", exact: true }).click();
  await expect(page).toHaveURL(`${origin}/`);
  await expect(page.getByRole("heading", { name: "ART & STUFF", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Log out", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit Untitled", exact: true })).toHaveCount(0);
  expect((await ownerPost(`/api/images/${id}/tags`)).status()).toBe(403);
  expect((await page.request.get(`/api/images/${id}/tags`)).status()).toBe(403);
  await page.reload();
  await expect(page.getByRole("link", { name: "Log out", exact: true })).toHaveCount(0);
 } finally {
  await page.goto("/signin-with-chatgpt?return_to=/manage");
  expect((await page.request.delete(`/api/images/${id}`, { headers: { origin } })).status()).toBe(200);
 }
});
