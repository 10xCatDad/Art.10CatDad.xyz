import { env } from "cloudflare:workers";
import { MAX_IMAGE_BYTES, UPLOAD_PART_BYTES } from "./images";
export type UploadSession = { id: string; upload_id: string; mime: string; width: number; height: number; bytes: number; state: string; created_at: number };
export class UploadError extends Error { constructor(message: string, readonly status = 400) { super(message); } }
export async function boundedBody(request: Request, max: number): Promise<Uint8Array<ArrayBuffer>> {
 const declared = Number(request.headers.get("content-length"));
 if (declared > max) throw new UploadError("This upload request is too large.", 413);
 if (!request.body) throw new UploadError("Missing upload data.");
 const reader = request.body.getReader(), buffer = new Uint8Array(max); let used = 0;
 try { while (true) { const { value, done } = await reader.read(); if (done) break; if (used + value.length > max) throw new UploadError("This upload request is too large.", 413); buffer.set(value, used); used += value.length; } }
 finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
 return buffer.subarray(0, used);
}
export async function sessionFor(id: string) {
 const session = await env.DB!.prepare("SELECT * FROM uploads WHERE id = ?").bind(id).first<UploadSession>();
 if (!session || session.created_at < Date.now() - 86400000) throw new UploadError("This upload expired. Choose the image again.", 404);
 return session;
}
export function partSize(session: UploadSession, part: number) {
 if (!Number.isInteger(part) || part < 1 || part > Math.ceil(session.bytes / UPLOAD_PART_BYTES) || session.bytes > MAX_IMAGE_BYTES) throw new UploadError("Invalid upload part.");
 return Math.min(UPLOAD_PART_BYTES, session.bytes - (part - 1) * UPLOAD_PART_BYTES);
}
export async function discardUpload(session: UploadSession) {
 // A lost completion response must never delete an already-published image.
 const published = await env.DB!.prepare("SELECT id FROM images WHERE id = ?").bind(session.id).first();
 if (!published) {
  await env.BUCKET!.resumeMultipartUpload(`${session.id}/original`, session.upload_id).abort().catch(() => {});
  await env.BUCKET!.delete([`${session.id}/original`, `${session.id}/thumbnail`]);
 }
 await env.DB!.prepare("DELETE FROM uploads WHERE id = ?").bind(session.id).run();
}
export async function cleanExpiredUploads() {
 const expired = await env.DB!.prepare("SELECT * FROM uploads WHERE created_at < ? LIMIT 3").bind(Date.now() - 86400000).all<UploadSession>();
 for (const session of expired.results) await discardUpload(session);
}
export function uploadError(error: unknown) {
 if (error instanceof UploadError) return Response.json({ error: error.message }, { status: error.status });
 console.error("Upload storage operation failed");
 return Response.json({ error: "The image could not be saved. Try uploading again." }, { status: 500 });
}
