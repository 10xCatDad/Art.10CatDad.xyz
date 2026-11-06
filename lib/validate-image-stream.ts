// Parse containers using a bounded input buffer. Large images never become a
// single Worker allocation. The upload UI strips metadata before this check.
class ImageReader {
 private reader: ReadableStreamDefaultReader<Uint8Array>;
 private chunk: Uint8Array = new Uint8Array();
 private offset = 0;
 position = 0;
 readonly size: number;
 constructor(stream: ReadableStream<Uint8Array>, size: number) { this.reader = stream.getReader(); this.size = size; }
 async available() {
  while (this.offset === this.chunk.length) {
   const next = await this.reader.read();
   if (next.done) throw new Error("The image file is incomplete.");
   this.chunk = next.value; this.offset = 0;
  }
 }
 async take(count: number): Promise<Uint8Array> {
  if (count < 0 || count > 65536 || this.position + count > this.size) throw new Error("The image file is damaged.");
  const out = new Uint8Array(count); let written = 0;
  while (written < count) { await this.available(); const n = Math.min(count - written, this.chunk.length - this.offset); out.set(this.chunk.subarray(this.offset, this.offset + n), written); written += n; this.offset += n; this.position += n; }
  return out;
 }
 async skip(count: number) {
  if (count < 0 || this.position + count > this.size) throw new Error("The image file is damaged.");
  while (count) { await this.available(); const n = Math.min(count, this.chunk.length - this.offset); this.offset += n; this.position += n; count -= n; }
 }
 async byte() { await this.available(); this.position++; if (this.position > this.size) throw new Error("The image file is damaged."); return this.chunk[this.offset++]; }
 async scanMarker() {
  // Scan JPEG entropy data in native array searches, handling escaped FF bytes
  // and restart markers even when they cross network-buffer boundaries.
  while (this.position < this.size) {
   await this.available();
   const found = this.chunk.indexOf(255, this.offset);
   if (found < 0) { await this.skip(this.chunk.length - this.offset); continue; }
   await this.skip(found - this.offset + 1);
   let marker = await this.byte(); while (marker === 255) marker = await this.byte();
   if (marker !== 0 && !(marker >= 0xd0 && marker <= 0xd7)) return marker;
  }
  throw new Error("The image file is incomplete.");
 }
 async close() { await this.reader.cancel().catch(() => {}); this.reader.releaseLock(); }
}
const ascii = (b: Uint8Array) => String.fromCharCode(...b);
const u32 = (b: Uint8Array, little = false) => new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(0, little);
const fail = (): never => { throw new Error("The image file is damaged or unsupported."); };
const metadata = (): never => { throw new Error("The image contains embedded metadata. Upload it through the gallery to remove it."); };
export async function validateImageStream(stream: ReadableStream<Uint8Array>, size: number, mime: string, expectedWidth: number, expectedHeight: number) {
 const r = new ImageReader(stream, size); let width = 0, height = 0, hasPixels = false;
 try {
  if (mime === "image/png") {
   const signature = await r.take(8);
   if (![137,80,78,71,13,10,26,10].every((x,i) => signature[i] === x)) fail();
   let first = true, ended = false;
   const allowed = new Set(["IHDR","PLTE","tRNS","IDAT","IEND","sRGB","gAMA","cHRM"]);
   while (r.position < size) {
    const header = await r.take(8), length = u32(header), type = ascii(header.subarray(4));
    if (first && type !== "IHDR") fail(); first = false;
    if (!allowed.has(type)) metadata();
    if (type === "IHDR") { if (width || length !== 13) fail(); const h = await r.take(13); width = u32(h); height = u32(h.subarray(4)); }
    else { if (type === "IDAT") hasPixels = true; await r.skip(length); }
    await r.skip(4); // CRC is part of the image container, not metadata.
    if (type === "IEND") { if (length !== 0) fail(); ended = true; break; }
   }
   if (!ended) fail();
  } else if (mime === "image/webp") {
   const signature = await r.take(12);
   if (ascii(signature.subarray(0,4)) !== "RIFF" || ascii(signature.subarray(8)) !== "WEBP" || u32(signature.subarray(4),true) + 8 !== size) fail();
   while (r.position < size) {
    const header = await r.take(8), type = ascii(header.subarray(0,4)), length = u32(header.subarray(4),true);
    if (!["VP8X","VP8 ","VP8L","ALPH"].includes(type)) metadata();
    if (type === "VP8X") {
     if (length !== 10) fail(); const h = await r.take(10);
     if (h[0] & (0x20 | 0x08 | 0x04 | 0x02)) metadata();
     width = 1 + h[4] + (h[5] << 8) + (h[6] << 16); height = 1 + h[7] + (h[8] << 8) + (h[9] << 16);
    } else if (type === "VP8 ") {
     if (length < 10) fail(); const h = await r.take(10);
     if (h[3] !== 0x9d || h[4] !== 1 || h[5] !== 0x2a) fail();
     width ||= (h[6] | (h[7] << 8)) & 0x3fff; height ||= (h[8] | (h[9] << 8)) & 0x3fff;
     await r.skip(length - 10); hasPixels = true;
    } else if (type === "VP8L") {
     if (length < 5) fail(); const h = await r.take(5); if (h[0] !== 0x2f) fail();
     width ||= 1 + (h[1] | ((h[2] & 0x3f) << 8)); height ||= 1 + ((h[2] >> 6) | (h[3] << 2) | ((h[4] & 0xf) << 10));
     await r.skip(length - 5); hasPixels = true;
    } else await r.skip(length);
    if (length % 2) await r.skip(1);
   }
  } else if (mime === "image/jpeg") {
   const signature = await r.take(2); if (signature[0] !== 255 || signature[1] !== 216) fail();
   let nextMarker: number | null = null, ended = false;
   while (nextMarker !== null || r.position < size) {
    let marker: number;
    if (nextMarker !== null) { marker = nextMarker; nextMarker = null; }
    else { if (await r.byte() !== 255) fail(); marker = await r.byte(); while (marker === 255) marker = await r.byte(); }
    if (marker === 0xd9) { ended = true; break; }
    if (marker >= 0xe1 && marker <= 0xef || marker === 0xfe) metadata();
    const lengthBytes = await r.take(2), length = (lengthBytes[0] << 8) + lengthBytes[1] - 2;
    if (length < 0) fail();
    if (marker === 0xe0) {
     if (length !== 14) metadata(); const h = await r.take(14);
     if (ascii(h.subarray(0,5)) !== "JFIF\0" || h[12] || h[13]) metadata();
    } else if ([0xc0,0xc1,0xc2].includes(marker)) {
     if (length < 6) fail(); const h = await r.take(6); height = (h[1] << 8) + h[2]; width = (h[3] << 8) + h[4]; await r.skip(length - 6);
    } else await r.skip(length);
    if (marker === 0xda) { hasPixels = true; nextMarker = await r.scanMarker(); }
   }
   if (!ended) fail();
  } else fail();
  if (r.position !== size || !hasPixels || width !== expectedWidth || height !== expectedHeight || width < 1 || height < 1 || width > 30000 || height > 30000 || width * height > 100000000) fail();
 } finally { await r.close(); }
}
