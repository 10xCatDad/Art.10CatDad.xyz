import { test, expect, type APIRequestContext } from "@playwright/test";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { stripMetadata } from "../lib/strip-metadata";
const origin = process.env.ART_TEST_ORIGIN || "http://127.0.0.1:5187";
const headers = { origin };
const workerHeaders = { authorization: `Bearer ${process.env.TAGGER_TOKEN || ""}` };
async function upload(request: APIRequestContext, title: string) {
 const image = sharp({ create: { width: 80, height: 64, channels: 3, background: "#7187aa" } });
 const original = Buffer.from(stripMetadata(await image.png().toBuffer(), "image/png")), thumbnail = await image.webp().toBuffer();
 const start = await request.post("/api/uploads", { headers, data: { mime: "image/png", bytes: original.length, width: 80, height: 64 } });
 expect(start.status()).toBe(201); const { id } = await start.json();
 const part = await request.put(`/api/uploads/${id}?part=1`, { headers, data: original });
 expect(part.status()).toBe(200);
 const done = await request.post(`/api/uploads/${id}`, { headers, multipart: { title, parts: JSON.stringify([await part.json()]), thumbnail: { name: "preview.webp", mimeType: "image/webp", buffer: thumbnail } } });
 expect(done.status(), await done.text()).toBe(201); return id as string;
}
function localSql(sql: string) {
 expect(new URL(origin).hostname).toBe("127.0.0.1");
 execFileSync(process.execPath, ["--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB", "--local", "--config", "dist/server/wrangler.json", "--persist-to", ".wrangler/state", "--command", sql], { stdio: "pipe" });
}

test("favorites, albums, exact tag filters, sorting, and owner-only organization", async ({ page, request }) => {
 const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
 expect(new URL(origin).hostname).toBe("127.0.0.1");
 const absent = randomUUID();
 for (const path of ["/api/albums", "/api/images/bulk", "/api/tags"]) expect((await request.post(path, { headers, data: {} })).status()).toBe(403);
 expect((await request.patch(`/api/albums/${absent}`, { headers, data: { name: "No" } })).status()).toBe(403);
 expect((await request.delete(`/api/albums/${absent}`, { headers })).status()).toBe(403);
 expect((await request.get("/api/tags")).status()).toBe(403);
 await page.goto("/signin-with-chatgpt?return_to=/manage");
 const ids: string[] = [], albums: string[] = [];
 try {
  for (const name of ["Alpha", "Beta", "Gamma"]) ids.push(await upload(page.request, name));
  for (const [index, tags] of ["cat, blue", "cathedral, red", "cat, red"].entries()) expect((await page.request.patch(`/api/images/${ids[index]}`, { headers, data: { title: ["Alpha", "Beta", "Gamma"][index], tags } })).status()).toBe(200);
  await page.reload();
  await page.getByRole("button", { name: "Favorite Alpha", exact: true }).click();
  await expect(page.getByRole("button", { name: "Unfavorite Alpha", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "New album", exact: true }).click();
  await page.getByLabel("Album name").fill("Studies");
  await page.getByRole("button", { name: "Create album", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "New album" })).not.toBeVisible();
  const listing = await (await request.get("/api/albums")).json(); const album = listing.albums[0].id; albums.push(album);
  await page.getByRole("checkbox", { name: "Select Alpha", exact: true }).check();
  await page.getByRole("checkbox", { name: "Select Gamma", exact: true }).check();
  await page.getByLabel("Album for selected images").selectOption(album);
  await page.getByRole("button", { name: "Add to album", exact: true }).click();
  await expect.poll(async () => (await (await request.get(`/api/images?album=${album}`)).json()).total).toBe(2);
  await page.getByLabel("Filter by album").selectOption(album);
  await expect(page.getByRole("button", { name: "View Beta", exact: true })).toHaveCount(0);
  await page.getByLabel("Filter by tag").selectOption("cat");
  await expect(page.getByRole("button", { name: "View Alpha", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Favorites", exact: true }).click();
  await expect(page.getByRole("button", { name: "View Gamma", exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "Favorites", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Filter by album")).toHaveValue(album);
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  expect((await (await request.get(`/api/images?album=${album}&tag=cat&favorites=1`)).json()).items.map((i: { id: string }) => i.id)).toEqual([ids[0]]);
  expect((await (await request.get("/api/images?tag=cat")).json()).total).toBe(2);
  expect((await (await request.get("/api/images?sort=title")).json()).items.map((i: { title: string }) => i.title)).toEqual(["Alpha", "Beta", "Gamma"]);
  expect((await (await request.get("/api/images?sort=oldest")).json()).items.map((i: { id: string }) => i.id)).toEqual(ids);
  expect((await (await request.get("/api/images?sort=tag")).json()).items.map((i: { id: string }) => i.id)).toEqual([ids[0], ids[2], ids[1]]);
  expect((await (await request.get("/api/images?sort=favorites")).json()).items[0].id).toBe(ids[0]);
  expect((await page.request.post("/api/images/bulk", { headers: { origin: "https://example.invalid" }, data: { action: "favorite", ids, favorite: false } })).status()).toBe(403);
  expect((await page.request.post("/api/images/bulk", { headers, data: { action: "favorite", ids: ["invalid"], favorite: true } })).status()).toBe(400);
  const second = await (await page.request.post("/api/albums", { headers, data: { name: "Second" } })).json(); albums.push(second.id);
  expect((await page.request.post("/api/images/bulk", { headers, data: { action: "addToAlbum", ids: [ids[0]], album: second.id } })).status()).toBe(200);
  await page.getByLabel("Filter by album").selectOption(album);
  await page.getByRole("button", { name: "Rename album", exact: true }).click();
  await page.getByLabel("Album name").fill("Color studies");
  await page.getByRole("button", { name: "Save album", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Rename album" })).not.toBeVisible();
  await page.getByRole("checkbox", { name: "Select Gamma", exact: true }).check();
  await page.getByRole("button", { name: "Remove from this album", exact: true }).click();
  await expect(page.getByRole("button", { name: "View Gamma", exact: true })).toHaveCount(0);
  expect((await (await request.get(`/api/images?album=${second.id}`)).json()).total).toBe(1);
  expect((await request.get(`/api/images/${ids[2]}`)).status()).toBe(200);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "outputs/organization-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Delete album", exact: true }).click();
  await expect.poll(async () => (await (await request.get("/api/albums")).json()).albums.length).toBe(1);
  expect((await request.get(`/api/images/${ids[0]}`)).status()).toBe(200);
  await page.getByRole("link", { name: "Log out", exact: true }).click();
  await expect(page).toHaveURL(`${origin}/`);
  await page.getByRole("button", { name: "Favorites", exact: true }).click();
  await expect(page.getByRole("button", { name: "View Alpha", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "View Beta", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New album", exact: true })).toHaveCount(0);
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await page.getByLabel("Filter by album").selectOption(second.id);
  await expect(page.getByRole("button", { name: "View Alpha", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
 } finally {
  await page.goto("/signin-with-chatgpt?return_to=/manage");
  for (const id of albums) await page.request.delete(`/api/albums/${id}`, { headers });
  for (const id of ids) await page.request.delete(`/api/images/${id}`, { headers });
 }
});

test("bulk generation covers every untagged page, survives long waits, saves once, and preserves edits", async ({ page, request }) => {
 test.skip(!process.env.TAGGER_TOKEN, "Set the local worker token to exercise tagging.");
 test.setTimeout(90000);
 await page.goto("/signin-with-chatgpt?return_to=/manage");
 const ids = Array.from({ length: 64 }, () => randomUUID());
 try {
  // Local-only fixtures exercise pagination without storing gallery media.
  localSql(`INSERT INTO images (id,title,tags,mime,width,height,bytes,created_at) VALUES ${ids.map((id, i) => `('${id}','Bulk ${String(i).padStart(2, "0")}','${i === 63 ? "manual" : ""}','image/png',1,1,1,${i + 1})`).join(",")}`);
  await page.reload();
  await expect(page.getByRole("button", { name: "All untagged (63)", exact: true })).toBeEnabled();
  await page.getByLabel("Search images").fill("Bulk 01");
  await expect(page.getByRole("button", { name: "View Bulk 01", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "All untagged (63)", exact: true }).click();
  await expect.poll(async () => (await (await page.request.get("/api/tags")).json()).pending).toBe(63);
  expect((await (await request.get("/api/images")).json()).items).toHaveLength(60);
  expect((await (await page.request.get(`/api/images/${ids[63]}/tags`)).json()).state).toBe("idle");
  expect((await page.request.post("/api/tags", { headers, data: { scope: "untagged" } })).status()).toBe(202);
  expect((await (await page.request.get("/api/tags")).json()).pending).toBe(63);
  // Older pending jobs must remain claimable, and their run deadline starts at claim.
  localSql("UPDATE image_tag_jobs SET requested_at=1 WHERE state='pending'");
  await page.goto("/");
  expect((await request.post("/api/tagger/heartbeat", { headers: workerHeaders })).status()).toBe(200);
  const { job } = await (await request.post("/api/tagger/next", { headers: workerHeaders })).json();
  expect(ids).toContain(job.id);
  await page.goto("/signin-with-chatgpt?return_to=/manage");
  expect((await page.request.patch(`/api/images/${job.id}`, { headers, data: { title: "Manual edit during tagging", caption: "Keep me", tags: "My tag, blue" } })).status()).toBe(200);
  const result = { id: job.id, lease: job.lease, tags: ["blue", "abstract"] };
  expect((await request.post("/api/tagger/complete", { headers: workerHeaders, data: result })).status()).toBe(200);
  expect((await request.post("/api/tagger/complete", { headers: workerHeaders, data: result })).status()).toBe(200);
  const image = await (await request.get(`/api/images/${job.id}`)).json();
  expect(image).toMatchObject({ title: "Manual edit during tagging", caption: "Keep me", tags: "My tag, blue, abstract" });
  // Saving a title from an editor that never changed its tags preserves generated tags.
  expect((await page.request.patch(`/api/images/${job.id}`, { headers, data: { title: "Title only", caption: "Keep me" } })).status()).toBe(200);
  expect((await (await request.get(`/api/images/${job.id}`)).json()).tags).toBe(image.tags);
  const next = (await (await request.post("/api/tagger/next", { headers: workerHeaders })).json()).job;
  expect((await request.post("/api/tagger/complete", { headers: workerHeaders, data: { ...next, error: true } })).status()).toBe(200);
  expect((await (await page.request.get("/api/tags")).json()).failed).toBe(1);
  const retry = await page.request.post("/api/tags", { headers, data: { scope: "failed" } });
  expect(retry.status()).toBe(202); expect((await retry.json()).queued).toBe(1);
  await page.getByLabel("Search images").fill("Bulk 63");
  await expect(page.locator(".art-card")).toHaveCount(1);
  await expect(page.getByRole("checkbox", { name: "Select Bulk 63", exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: "Select Bulk 63", exact: true }).check();
  await page.getByRole("button", { name: "Generate tags for selected", exact: true }).click();
  await expect.poll(async () => (await (await page.request.get(`/api/images/${ids[63]}/tags`)).json()).state).toBe("pending");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "outputs/bulk-tags-desktop.png", fullPage: true });
 } finally {
  localSql(`DELETE FROM image_tag_jobs WHERE image_id IN (${ids.map(id => `'${id}'`).join(",")}); DELETE FROM images WHERE id IN (${ids.map(id => `'${id}'`).join(",")})`);
 }
});
