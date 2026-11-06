import { test, expect, type APIRequestContext } from '@playwright/test';
import sharp from 'sharp';
import { randomFillSync, createHash } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import { stripMetadata } from '../lib/strip-metadata';

const origin = process.env.ART_TEST_ORIGIN || 'http://127.0.0.1:5187';
const headers = { origin };
const limit = 100 * 1024 * 1024;
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
async function start(request: APIRequestContext, bytes: number, mime = 'image/png', width = 32, height = 24) {
 const response = await request.post('/api/uploads', { headers, data: { mime, width, height, bytes } });
 expect(response.status(), await response.text()).toBe(201);
 return response.json() as Promise<{ id: string; partBytes: number }>;
}
async function putParts(request: APIRequestContext, upload: { id: string; partBytes: number }, bytes: Buffer) {
 const parts: { partNumber: number; etag: string }[] = [];
 for (let offset = 0; offset < bytes.length; offset += upload.partBytes) {
  const response = await request.put(`/api/uploads/${upload.id}?part=${parts.length + 1}`, { headers, data: bytes.subarray(offset, offset + upload.partBytes), timeout: 60000 });
  expect(response.status(), await response.text()).toBe(200); parts.push(await response.json());
 }
 return parts;
}
async function finish(request: APIRequestContext, id: string, parts: unknown[]) {
 const thumbnail = await sharp({ create: { width: 32, height: 24, channels: 3, background: '#8194ab' } }).withExif({ IFD0: { Artist: 'PRIVATE_PREVIEW_ARTIST' } }).webp().toBuffer();
 return request.post(`/api/uploads/${id}`, { headers, multipart: { parts: JSON.stringify(parts), thumbnail: { name: 'preview.webp', mimeType: 'image/webp', buffer: thumbnail } }, timeout: 60000 });
}

test('chunk uploads enforce owner access, size limits and private pending state', async ({ page, request }) => {
 const absent = '00000000-0000-4000-8000-000000000000';
 for (const response of [await request.post('/api/uploads', { headers }), await request.put(`/api/uploads/${absent}?part=1`, { headers }), await request.post(`/api/uploads/${absent}`, { headers }), await request.delete(`/api/uploads/${absent}`, { headers })]) expect(response.status()).toBe(403);
 await page.goto('/signin-with-chatgpt?return_to=/manage');
 await expect(page.getByRole('heading', { name: 'Manage gallery' })).toBeVisible();
 const owner = page.request;
 expect((await owner.post('/api/uploads', { headers: { origin: 'https://example.invalid' }, data: {} })).status()).toBe(403);
 expect((await owner.post('/api/uploads', { headers, data: { bytes: limit + 1, mime: 'image/png', width: 32, height: 24 } })).status()).toBe(413);
 const boundary = await start(owner, limit);
 expect((await request.get(`/media/${boundary.id}/original`)).status()).toBe(404);
 expect((await owner.put(`/api/uploads/${boundary.id}?part=1`, { headers, data: Buffer.alloc(16) })).status()).toBe(400);
 expect((await owner.put(`/api/uploads/${boundary.id}?part=13`, { headers, data: Buffer.alloc(limit % boundary.partBytes + 1) })).status()).toBe(413);
 expect((await owner.put(`/api/uploads/${boundary.id}?part=14`, { headers, data: Buffer.alloc(16) })).status()).toBe(400);
 expect((await finish(owner, boundary.id, [])).status()).toBe(400);
 expect((await owner.delete(`/api/uploads/${boundary.id}`, { headers })).status()).toBe(200);
 expect((await owner.put(`/api/uploads/${boundary.id}?part=1`, { headers, data: Buffer.alloc(16) })).status()).toBe(404);

 const privateImage = await sharp({ create: { width: 32, height: 24, channels: 3, background: '#8194ab' } }).withExif({ IFD0: { Artist: 'PRIVATE_ARTIST' } }).png().toBuffer();
 const rejected = await start(owner, privateImage.length);
 const rejectedParts = await putParts(owner, rejected, privateImage);
 expect((await request.get(`/media/${rejected.id}/original`)).status()).toBe(404);
 const response = await finish(owner, rejected.id, rejectedParts);
 expect(response.status(), await response.text()).toBe(400);
 expect((await request.get(`/media/${rejected.id}/original`)).status()).toBe(404);
 expect((await owner.put(`/api/uploads/${rejected.id}?part=1`, { headers, data: privateImage })).status()).toBe(404);
});

test('browser uploads PNG, WebP and JPEG, including a file without a MIME label', async ({ page, request }) => {
 await page.goto('/signin-with-chatgpt?return_to=/manage');
 await expect(page.getByLabel('Choose images to upload')).toBeEnabled();
 const fixtures = await Promise.all(['png', 'webp', 'jpeg'].map(async format => ({ name: `art.${format}`, mimeType: format === 'webp' ? '' : `image/${format}`, buffer: await sharp({ create: { width: 73, height: 51, channels: 4, background: '#8194ab80' } }).withExif({ IFD0: { Artist: 'PRIVATE_ARTIST' } }).toFormat(format as 'png' | 'webp' | 'jpeg').toBuffer() })));
 try {
  await page.getByLabel('Choose images to upload').setInputFiles(fixtures);
  await expect(page.locator('.queue-row.uploading')).toHaveCount(0, { timeout: 30000 });
  await expect(page.getByText('3 of 3 uploaded')).toBeVisible();
  const listing = await (await request.get('/api/images')).json();
  expect(listing.total).toBe(3);
  expect(listing.items.map((item: { mime: string }) => item.mime).sort()).toEqual(['image/jpeg', 'image/png', 'image/webp']);
  for (const item of listing.items) {
   const data = await (await request.get(`/media/${item.id}/original`)).body();
   expect(data.includes(Buffer.from('PRIVATE_ARTIST'))).toBe(false);
   const meta = await sharp(data).metadata(); expect(meta.width).toBe(73); expect(meta.height).toBe(51); expect(meta.exif).toBeUndefined();
   if (item.mime !== 'image/jpeg') expect(meta.hasAlpha).toBe(true);
  }
 } finally {
  const listing = await (await request.get('/api/images')).json();
  for (const item of listing.items) await page.request.delete(`/api/images/${item.id}`, { headers });
 }
});

test('a real PNG near 100 MiB survives all chunks, validation and download', async ({ page, request }) => {
 test.setTimeout(180000);
 await page.goto('/signin-with-chatgpt?return_to=/manage');
 await expect(page.getByRole('heading', { name: 'Manage gallery' })).toBeVisible();
 const width = 6000, height = 5800;
 const input = randomFillSync(Buffer.allocUnsafe(width * height * 3));
 const raw = await sharp(input, { raw: { width, height, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer();
 const bytes = Buffer.from(stripMetadata(raw, 'image/png'));
 expect(bytes.length).toBeGreaterThan(99 * 1024 * 1024); expect(bytes.length).toBeLessThanOrEqual(limit);
 const upload = await start(page.request, bytes.length, 'image/png', width, height);
 try {
  const parts = await putParts(page.request, upload, bytes);
  expect(parts.length).toBe(13);
  expect((await request.get(`/media/${upload.id}/original`)).status()).toBe(404);
  const complete = await finish(page.request, upload.id, parts);
  expect(complete.status(), await complete.text()).toBe(201);
  const thumbnail = await (await request.get(`/media/${upload.id}/thumbnail`)).body();
  expect(thumbnail.includes(Buffer.from('PRIVATE_PREVIEW_ARTIST'))).toBe(false);
  expect((await sharp(thumbnail).metadata()).exif).toBeUndefined();
  expect((await finish(page.request, upload.id, parts)).status()).toBe(200);
  // A repeated cancellation after a lost completion response must preserve the image.
  expect((await page.request.delete(`/api/uploads/${upload.id}`, { headers })).status()).toBe(200);
  const downloaded = await (await request.get(`/media/${upload.id}/original`, { timeout: 60000 })).body();
  expect(downloaded.length).toBe(bytes.length); expect(digest(downloaded)).toBe(digest(bytes));
  const meta = await sharp(downloaded).metadata(); expect(meta.width).toBe(width); expect(meta.height).toBe(height);
  console.log(`Validated ${bytes.length} byte PNG (${(bytes.length / 1024 / 1024).toFixed(2)} MiB) across ${parts.length} parts.`);
 } finally {
  await page.request.delete(`/api/uploads/${upload.id}`, { headers });
  await page.request.delete(`/api/images/${upload.id}`, { headers });
 }
 expect((await request.get(`/media/${upload.id}/original`)).status()).toBe(404);
 // The same near-limit source must also work through the owner's file picker,
 // pixel conversion and thumbnail generation, not only the chunk API.
 const fixturePath = 'outputs/large-upload.png';
 await writeFile(fixturePath, bytes);
 try {
  await page.reload();
  await expect(page.getByLabel('Choose images to upload')).toBeEnabled();
  await page.getByLabel('Choose images to upload').setInputFiles(fixturePath);
  await expect(page.locator('.queue-row.uploading')).toHaveCount(0, { timeout: 90000 });
  await expect(page.getByText('1 of 1 uploaded')).toBeVisible();
 } finally {
  await unlink(fixturePath);
  const listing = await (await request.get('/api/images')).json();
  for (const item of listing.items) await page.request.delete(`/api/images/${item.id}`, { headers });
 }
});
