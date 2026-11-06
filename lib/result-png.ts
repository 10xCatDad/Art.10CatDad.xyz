export const MAX_RESULT_BYTES = 2 * 1024 * 1024;
const signature = [137,80,78,71,13,10,26,10];
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let bit = 0; bit < 8; bit++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc(bytes: Uint8Array) { let value = 0xffffffff; for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8); return (value ^ 0xffffffff) >>> 0; }
const invalid = (): never => { throw new Error("Invalid result image"); };

// Accept the bounded RGB/RGBA PNGs produced by the result renderer. Keep only
// the pixel container: EXIF, text, XMP, comments, profiles and unknown ancillary
// chunks never reach storage. CRC and decompressed-size checks reject corrupt
// streams and compressed image bombs before any R2 write.
export async function cleanResultPng(bytes: Uint8Array) {
  if (bytes.length > MAX_RESULT_BYTES || bytes.length < 45 || !signature.every((value, i) => bytes[i] === value)) invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), kept: Uint8Array[] = [bytes.subarray(0, 8)], pixels: Uint8Array[] = [];
  let pos = 8, width = 0, height = 0, channels = 0, ended = false, dataEnded = false;
  while (pos + 12 <= bytes.length) {
    const size = view.getUint32(pos), end = pos + size + 12;
    if (end > bytes.length) invalid();
    const name = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8));
    if (!/^[A-Za-z]{4}$/.test(name) || crc(bytes.subarray(pos + 4, end - 4)) !== view.getUint32(end - 4)) invalid();
    if (!width && name !== "IHDR") invalid();
    if (name === "IHDR") {
      if (width || pos !== 8 || size !== 13) invalid();
      width = view.getUint32(pos + 8); height = view.getUint32(pos + 12);
      const depth = bytes[pos + 16], color = bytes[pos + 17];
      if (depth !== 8 || ![2,6].includes(color) || bytes[pos + 18] || bytes[pos + 19] || bytes[pos + 20] || width < 1 || height < 1 || width > 1600 || height > 2000 || width * height > 3_000_000) invalid();
      channels = color === 6 ? 4 : 3; kept.push(bytes.subarray(pos, end));
    } else if (name === "IDAT") {
      if (dataEnded) invalid(); pixels.push(bytes.subarray(pos + 8, end - 4)); kept.push(bytes.subarray(pos, end));
    } else if (name === "IEND") {
      if (size || !pixels.length || end !== bytes.length) invalid(); kept.push(bytes.subarray(pos, end)); ended = true; break;
    } else {
      if (pixels.length) dataEnded = true;
      if (name[0] === name[0].toUpperCase()) invalid();
    }
    pos = end;
  }
  if (!ended) invalid();
  const stride = width * channels + 1, expected = stride * height;
  const reader = new Blob(pixels as BlobPart[]).stream().pipeThrough(new DecompressionStream("deflate")).getReader();
  let decoded = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      if (decoded + value.length > expected) invalid();
      for (let i = (stride - decoded % stride) % stride; i < value.length; i += stride) if (value[i] > 4) invalid();
      decoded += value.length;
    }
    if (decoded !== expected) invalid();
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return { image: new Blob(kept as BlobPart[], { type: "image/png" }), width, height };
}
