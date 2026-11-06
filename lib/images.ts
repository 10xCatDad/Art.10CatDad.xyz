export const UPLOAD_PART_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 100 * 1024 * 1024;
export const MAX_THUMB_BYTES = 1024 * 1024;
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
export type ArtImage = { id: string; title: string; caption: string; tags: string; mime: string; width: number; height: number; bytes: number; created_at: number; favorite: number };
export function metadata(input: { title?: unknown; caption?: unknown; tags?: unknown }) {
 const clean = (v: unknown, max: number) => typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max) : "";
 return { title: clean(input.title, 160) || "Untitled", caption: clean(input.caption, 3000), tags: [...new Set(clean(input.tags, 600).split(",").map(t => t.trim().slice(0, 40)).filter(Boolean))].slice(0, 12).join(", ") };
}
export function sniffImage(bytes: Uint8Array): string | null {
 if (bytes.length < 12) return null;
 if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
 if ([137,80,78,71,13,10,26,10].every((x,i) => bytes[i] === x)) return "image/png";
 const ascii = (a: number,b: number) => String.fromCharCode(...bytes.slice(a,b));
 if (ascii(0,4) === "RIFF" && ascii(8,12) === "WEBP") return "image/webp";
 return null;
}
export function isImageId(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value); }
