import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { stripMetadata } from '../lib/strip-metadata.ts';
import { validateImageStream } from '../lib/validate-image-stream.ts';
import { needsTransparency, stripEncodedMetadata } from '../lib/strip-encoded-metadata.ts';

function stream(bytes, chunkSize) {
 let offset = 0;
 return new ReadableStream({ pull(controller) {
  if (offset === bytes.length) return controller.close();
  const end = Math.min(bytes.length, offset + chunkSize);
  controller.enqueue(bytes.subarray(offset, end)); offset = end;
 } });
}
for (const format of ['png', 'jpeg', 'webp']) {
 test(`${format} stream validates across container and JPEG-marker boundaries`, async () => {
  const input = await sharp({ create: { width: 73, height: 51, channels: 4, background: '#8194ab80' } })[format]().toBuffer();
  const cleaned = stripMetadata(input, `image/${format}`);
  for (const chunk of [1, 7, 64, 65536]) await validateImageStream(stream(cleaned, chunk), cleaned.length, `image/${format}`, 73, 51);
  await assert.rejects(validateImageStream(stream(cleaned, 7), cleaned.length, `image/${format}`, 72, 51));
  await assert.rejects(validateImageStream(stream(cleaned.subarray(0, cleaned.length - 8), 7), cleaned.length, `image/${format}`, 73, 51));
  const trailing = Buffer.concat([cleaned, Buffer.from('PRIVATE_TRAILING_DATA')]);
  await assert.rejects(validateImageStream(stream(trailing, 7), trailing.length, `image/${format}`, 73, 51));
 });
 test(`${format} stream rejects private metadata before publication`, async () => {
  const input = await sharp({ create: { width: 32, height: 24, channels: 3, background: '#8194ab' } }).withExif({ IFD0: { Artist: 'PRIVATE_ARTIST' } })[format]().toBuffer();
  await assert.rejects(validateImageStream(stream(input, 7), input.length, `image/${format}`, 32, 24), /metadata/);
  const blob = await stripEncodedMetadata(new Blob([input], { type: `image/${format}` }));
  await validateImageStream(blob.stream(), blob.size, blob.type, 32, 24);
  const output = Buffer.from(await blob.arrayBuffer());
  assert.equal(output.includes(Buffer.from('PRIVATE_ARTIST')), false);
  assert.deepEqual(await sharp(output).raw().toBuffer(), await sharp(input).raw().toBuffer());
 });
}
test('progressive JPEG validates multiple entropy scans', async () => {
 const bytes = await sharp({ create: { width: 73, height: 51, channels: 3, background: '#8194ab' } }).jpeg({ progressive: true }).toBuffer();
 await validateImageStream(stream(bytes, 3), bytes.length, 'image/jpeg', 73, 51);
});

test('PNG opacity detection preserves alpha and palette transparency', async () => {
 for (const [channels, palette, background, expected] of [[3, false, '#8194ab', false], [4, false, '#8194ab80', true], [4, true, '#8194ab80', true]]) {
  const bytes = await sharp({ create: { width: 32, height: 24, channels, background } }).png({ palette }).toBuffer();
  assert.equal(await needsTransparency(new Blob([bytes]), 'image/png'), expected);
 }
});

for (const format of ['png', 'jpeg', 'webp']) {
 test(`${format} strips and rejects EXIF/GPS, XMP and comment containers`, async () => {
  const base = await sharp({ create: { width: 32, height: 24, channels: 3, background: '#8194ab' } })[format]().toBuffer();
  for (const kind of ['EXIF_GPSLatitude_PRIVATE', 'XMP_PRIVATE_OWNER', 'COMMENT_PRIVATE_PROMPT']) {
   const payload = Buffer.from(kind); let input;
   if (format === 'jpeg') {
    const header = Buffer.from([255, kind.startsWith('COMMENT') ? 0xfe : 0xe1, 0, payload.length + 2]);
    input = Buffer.concat([base.subarray(0, 2), header, payload, base.subarray(2)]);
   } else if (format === 'png') {
    const type = kind.startsWith('EXIF') ? 'eXIf' : kind.startsWith('XMP') ? 'iTXt' : 'tEXt';
    const header = Buffer.alloc(8); header.writeUInt32BE(payload.length); header.write(type, 4);
    // Rejected headers are recognized before payload or checksum processing.
    input = Buffer.concat([base.subarray(0, 33), header, payload, Buffer.alloc(4), base.subarray(33)]);
   } else {
    const header = Buffer.alloc(8); header.write(kind.startsWith('EXIF') ? 'EXIF' : 'XMP '); header.writeUInt32LE(payload.length, 4);
    input = Buffer.concat([base, header, payload, Buffer.alloc(payload.length % 2)]); input.writeUInt32LE(input.length - 8, 4);
   }
   await assert.rejects(validateImageStream(stream(input, 7), input.length, `image/${format}`, 32, 24), /metadata/);
   const cleaned = await stripEncodedMetadata(new Blob([input], { type: `image/${format}` }));
   await validateImageStream(cleaned.stream(), cleaned.size, cleaned.type, 32, 24);
   assert.equal(Buffer.from(await cleaned.arrayBuffer()).includes(payload), false);
  }
 });
}
