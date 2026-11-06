// Strip non-rendering metadata on the server as well as in the upload UI.
// Reject malformed containers instead of storing partially parsed files.
function join(parts: Uint8Array[]) {
 const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
 let offset = 0; for (const part of parts) { result.set(part, offset); offset += part.length; }
 return result;
}
const ascii = (data: Uint8Array, start: number, end: number) => String.fromCharCode(...data.slice(start, end));
function invalid(): never { throw new Error("The image file is damaged or unsupported."); }
export function stripMetadata(data: Uint8Array, mime: string): Uint8Array {
 const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
 if (mime === "image/png") {
  const parts = [data.slice(0, 8)]; let pos = 8, hasData = false;
  const allowed = new Set(["IHDR", "PLTE", "tRNS", "IDAT", "IEND", "sRGB", "gAMA", "cHRM", "acTL", "fcTL", "fdAT"]);
  while (pos + 12 <= data.length) {
   const length = view.getUint32(pos), type = ascii(data, pos + 4, pos + 8), end = pos + 12 + length;
   if (end > data.length) invalid();
   if (type === "IDAT") hasData = true;
   if (allowed.has(type)) parts.push(data.slice(pos, end));
   if (type === "IEND") { if (!hasData) invalid(); return join(parts); }
   pos = end;
  }
  invalid();
 }
 if (mime === "image/webp") {
  const parts: Uint8Array[] = []; let pos = 12, hasData = false;
  const allowed = new Set(["VP8 ", "VP8L", "VP8X", "ALPH", "ANIM", "ANMF"]);
  while (pos + 8 <= data.length) {
   const type = ascii(data, pos, pos + 4), length = view.getUint32(pos + 4, true), end = pos + 8 + length + (length % 2);
   if (end > data.length) invalid();
   if (["VP8 ", "VP8L", "ANMF"].includes(type)) hasData = true;
   if (allowed.has(type)) { const chunk = data.slice(pos, end); if (type === "VP8X") { if (length < 10) invalid(); chunk[8] &= ~(0x20 | 0x08 | 0x04); } parts.push(chunk); }
   pos = end;
  }
  if (!hasData || pos !== data.length) invalid();
  const header = data.slice(0, 12), body = join(parts);
  new DataView(header.buffer).setUint32(4, body.length + 4, true);
  return join([header, body]);
 }
 if (mime === "image/jpeg") {
  const parts = [data.slice(0, 2)]; let pos = 2, hasScan = false;
  while (pos < data.length) {
   const start = pos;
   if (data[pos++] !== 0xff) invalid();
   while (data[pos] === 0xff) pos++;
   const marker = data[pos++];
   if (marker === 0xd9) { if (!hasScan) invalid(); parts.push(data.slice(start, pos)); return join(parts); }
   if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { parts.push(data.slice(start, pos)); continue; }
   if (pos + 2 > data.length) invalid();
   const length = view.getUint16(pos), end = pos + length;
   if (length < 2 || end > data.length) invalid();
   if (!(marker >= 0xe0 && marker <= 0xef) && marker !== 0xfe) parts.push(data.slice(start, end));
   pos = end;
   if (marker === 0xda) {
    hasScan = true; const scanStart = pos;
    while (pos < data.length) {
     if (data[pos] !== 0xff) { pos++; continue; }
     let next = pos + 1; while (data[next] === 0xff) next++;
     if (data[next] === 0 || (data[next] >= 0xd0 && data[next] <= 0xd7)) { pos = next + 1; continue; }
     break;
    }
    parts.push(data.slice(scanStart, pos));
   }
  }
  invalid();
 }
 return invalid();
}
