// Canvas encoders may add color profiles and other headers. Remove them using
// Blob slices so a large image never needs another full-size JavaScript buffer.
// This accepts canvas output; the server independently validates the full stream.
export async function needsTransparency(file: Blob, mime: string): Promise<boolean> {
 if (mime === "image/jpeg") return false;
 if (mime !== "image/png") return true;
 const header = new Uint8Array(await file.slice(0, 26).arrayBuffer());
 if (header.length < 26 || [4, 6].includes(header[25])) return true;
 // Grayscale/RGB/palette PNGs are opaque unless a tRNS chunk appears before IDAT.
 // Keeping an opaque canvas avoids unnecessarily expanding RGB data to RGBA.
 let pos = 8;
 while (pos + 8 <= file.size) {
  const chunk = new Uint8Array(await file.slice(pos, pos + 8).arrayBuffer());
  const type = String.fromCharCode(...chunk.subarray(4));
  if (type === "tRNS") return true;
  if (type === "IDAT") return false;
  pos += new DataView(chunk.buffer).getUint32(0) + 12;
 }
 return true;
}
export async function stripEncodedMetadata(blob: Blob): Promise<Blob> {
 const parts: BlobPart[] = [];
 const read = async (start: number, count: number) => {
  if (start < 0 || start + count > blob.size) throw new Error("Image conversion failed.");
  return new Uint8Array(await blob.slice(start, start + count).arrayBuffer());
 };
 const ascii = (b: Uint8Array) => String.fromCharCode(...b);
 const u32 = (b: Uint8Array, little = false) => new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(0, little);
 if (blob.type === "image/png") {
  parts.push(blob.slice(0, 8)); let pos = 8;
  const allowed = new Set(["IHDR", "PLTE", "tRNS", "IDAT", "IEND", "sRGB", "gAMA", "cHRM"]);
  while (pos < blob.size) {
   const header = await read(pos, 8), type = ascii(header.subarray(4)), end = pos + u32(header) + 12;
   if (end > blob.size) throw new Error("Image conversion failed.");
   if (allowed.has(type)) parts.push(blob.slice(pos, end));
   pos = end;
   if (type === "IEND") return new Blob(parts, { type: blob.type });
  }
 } else if (blob.type === "image/webp") {
  const header = await read(0, 12); let pos = 12, kept = 0;
  while (pos < blob.size) {
   const chunkHeader = await read(pos, 8), type = ascii(chunkHeader.subarray(0, 4)), length = u32(chunkHeader.subarray(4), true), end = pos + 8 + length + (length % 2);
   if (end > blob.size) throw new Error("Image conversion failed.");
   if (["VP8 ", "VP8L", "ALPH"].includes(type)) { parts.push(blob.slice(pos, end)); kept += end - pos; }
   if (type === "VP8X") {
    if (length !== 10) throw new Error("Image conversion failed.");
    const chunk = await read(pos, end - pos); chunk[8] &= ~(0x20 | 0x08 | 0x04);
    parts.push(chunk); kept += chunk.length;
   }
   pos = end;
  }
  new DataView(header.buffer).setUint32(4, kept + 4, true);
  return new Blob([header, ...parts], { type: blob.type });
 } else if (blob.type === "image/jpeg") {
  parts.push(blob.slice(0, 2)); let pos = 2;
  while (pos < blob.size) {
   const start = pos; let header = await read(pos, 2);
   if (header[0] !== 255) throw new Error("Image conversion failed.");
   while (header[1] === 255) { pos++; header = await read(pos, 2); }
   const marker = header[1]; pos += 2;
   // Canvas creates a new pixel-only scan. Any later unexpected metadata is
   // rejected by server validation, including a future encoder's extra scans.
   if (marker === 0xda) return new Blob([...parts, blob.slice(start)], { type: blob.type });
   const lengthBytes = await read(pos, 2), length = (lengthBytes[0] << 8) + lengthBytes[1], end = pos + length;
   if (length < 2 || end > blob.size) throw new Error("Image conversion failed.");
   if (!(marker >= 0xe0 && marker <= 0xef) && marker !== 0xfe) parts.push(blob.slice(start, end));
   pos = end;
  }
 }
 throw new Error("Image conversion failed.");
}
