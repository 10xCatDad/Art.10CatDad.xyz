import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { stripMetadata } from '../lib/strip-metadata.ts';
for (const format of ['png', 'jpeg', 'webp']) {
 test(`${format} retains pixels while dropping embedded private metadata`, async () => {
  const marker='PRIVATE_EMBEDDED_ARTIST';
  const original=await sharp({create:{width:32,height:24,channels:3,background:'#8a78ad'}}).withExif({IFD0:{Artist:marker}})[format]().toBuffer();
  assert.ok(original.includes(Buffer.from(marker)));
  const cleaned=stripMetadata(original, `image/${format}`);
  assert.equal(Buffer.from(cleaned).includes(Buffer.from(marker)),false);
  const details=await sharp(cleaned).metadata();
  assert.equal(details.width,32);assert.equal(details.height,24);assert.equal(details.exif,undefined);
  assert.deepEqual(await sharp(cleaned).raw().toBuffer(),await sharp(original).raw().toBuffer());
 });
 test(`${format} rejects a truncated container`, async () => {
  const original=await sharp({create:{width:2,height:2,channels:3,background:'red'}})[format]().toBuffer();
  assert.throws(()=>stripMetadata(original.subarray(0,original.length-8),`image/${format}`));
 });
}
