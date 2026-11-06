import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { stripMetadata } from "../lib/strip-metadata";
const origin = process.env.ART_TEST_ORIGIN || "http://127.0.0.1:5187";

test("owner creates and revokes scoped Android access; native upload and edit work", async ({ page, request }) => {
 expect((await request.get("/api/companion/devices")).status()).toBe(403);
 expect((await request.get("/api/companion/session")).status()).toBe(401);
 expect((await request.post("/api/companion/devices", { headers: { origin }, data: { name: "Unauthorized" } })).status()).toBe(403);
 await page.goto("/signin-with-chatgpt?return_to=/manage/devices");
 await expect(page.getByRole("heading", { name: "Devices", exact: true })).toBeVisible();
 const old = await (await page.request.get("/api/companion/devices")).json();
 for (const device of old.devices) if (device.name === "Android test") await page.request.delete(`/api/companion/devices/${device.id}`, { headers: { origin } });
 await page.reload();
 await page.getByLabel("Device name").fill("Android test");
 await page.getByRole("button", { name: "CREATE KEY", exact: true }).click();
 const keyInput = page.getByLabel("Device key", { exact: true });
 await expect(keyInput).toHaveValue(/^art_device_[0-9a-f]{64}$/);
 const token = await keyInput.inputValue(), headers = { authorization: `Bearer ${token}` };
 // Hide secrets before screenshots. The test key exists only in this local DB.
 await page.getByRole("button", { name: "DONE", exact: true }).click();
 await page.setViewportSize({ width: 390, height: 844 });
 expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
 await page.screenshot({ path: "outputs/devices-mobile.png", fullPage: true });
 const session = await request.get("/api/companion/session", { headers });
 expect(session.status()).toBe(200); expect(session.headers()["cache-control"]).toBe("no-store");
 expect((await session.json()).device.name).toBe("Android test");
 expect((await request.post("/api/companion/devices", { headers: { ...headers, origin }, data: { name: "Not allowed" } })).status()).toBe(403);
 expect((await request.get("/api/companion/devices", { headers })).status()).toBe(403);
 const info = { mime: "image/png", width: 64, height: 48 };
 const original = Buffer.from(stripMetadata(await sharp({ create: { width: 64, height: 48, channels: 3, background: "#39ff88" } }).png().toBuffer(), "image/png"));
 const thumbnail = await sharp(original).webp().toBuffer();
 expect([401, 403]).toContain((await request.post("/api/uploads", { headers: { ...headers, origin: "https://evil.example" }, data: { ...info, bytes: original.length } })).status());
 const start = await request.post("/api/uploads", { headers, data: { ...info, bytes: original.length } });
 expect(start.status()).toBe(201);
 const { id } = await start.json();
 try {
  const part = await request.put(`/api/uploads/${id}?part=1`, { headers, data: original }); expect(part.status()).toBe(200);
  const result = await request.post(`/api/uploads/${id}`, { headers, multipart: { parts: JSON.stringify([await part.json()]), thumbnail: { name: "preview.webp", mimeType: "image/webp", buffer: thumbnail }, title: "Native companion test" } });
  expect(result.status(), await result.text()).toBe(201);
  expect((await request.patch(`/api/images/${id}`, { headers, data: { title: "Android edited", caption: "Local test", tags: "native, test" } })).status()).toBe(200);
  expect((await (await request.get(`/api/images/${id}`)).json()).title).toBe("Android edited");
  expect((await request.get(`/api/images/${id}/tags`, { headers })).status()).toBe(200);
  const ownerDevices = await (await page.request.get("/api/companion/devices")).json();
  expect(JSON.stringify(ownerDevices)).not.toContain(token);
  expect(JSON.stringify(ownerDevices)).not.toContain("token_hash");
  const device = ownerDevices.devices.find((d: { name: string }) => d.name === "Android test");
  expect((await request.delete(`/api/companion/devices/${device.id}`, { headers: { ...headers, origin } })).status()).toBe(403);
  page.once("dialog", d => d.accept());
  await page.getByRole("button", { name: "DISCONNECT", exact: true }).click();
  await expect(page.getByText("No devices connected.")).toBeVisible();
  expect((await request.get("/api/companion/session", { headers })).status()).toBe(401);
  expect((await request.patch(`/api/images/${id}`, { headers, data: { title: "No" } })).status()).toBe(401);
  expect((await request.delete(`/api/images/${id}`, { headers })).status()).toBe(401);
 } finally {
  await page.request.delete(`/api/images/${id}`, { headers: { origin } });
  await page.request.delete(`/api/uploads/${id}`, { headers: { origin } });
 }
});
