import { env } from "cloudflare:workers";
import { authorizeWrite } from "@/lib/auth";
import { isImageId, MAX_THUMB_BYTES, metadata, sniffImage, UPLOAD_PART_BYTES } from "@/lib/images";
import { stripMetadata } from "@/lib/strip-metadata";
import { validateImageStream } from "@/lib/validate-image-stream";
import { boundedBody, sessionFor, partSize, discardUpload, UploadError, uploadError, type UploadSession } from "@/lib/uploads";
type Context = { params: Promise<{ id: string }> };
async function access(request: Request, context: Context) {
 const denied = await authorizeWrite(request); if (denied) return denied;
 if (!env.DB || !env.BUCKET) return Response.json({ error: "Gallery storage is unavailable." }, { status: 503 });
 const { id } = await context.params;
 if (!isImageId(id)) return Response.json({ error: "Upload not found." }, { status: 404 });
 return id;
}
export async function PUT(request: Request, context: Context) {
 const id = await access(request, context); if (id instanceof Response) return id;
 try {
  const session = await sessionFor(id), part = Number(new URL(request.url).searchParams.get("part"));
  if (session.state !== "uploading") throw new UploadError("This upload is already being processed.", 409);
  const expected = partSize(session, part), body = await boundedBody(request, expected);
  if (body.byteLength !== expected) throw new UploadError("This upload part is incomplete.");
  if (part === 1 && sniffImage(body) !== session.mime) throw new UploadError("The image format does not match its file type.");
  const result = await env.BUCKET!.resumeMultipartUpload(`${id}/original`, session.upload_id).uploadPart(part, body);
  return Response.json(result);
 } catch (error) { return uploadError(error); }
}
export async function POST(request: Request, context: Context) {
 const id = await access(request, context); if (id instanceof Response) return id;
 let locked: UploadSession | null = null;
 try {
  if (await env.DB!.prepare("SELECT id FROM images WHERE id = ?").bind(id).first()) return Response.json({ id });
  const session = await sessionFor(id);
  const body = await boundedBody(request, MAX_THUMB_BYTES + 16384);
  let form: FormData; try { form = await new Response(body, { headers: { "Content-Type": request.headers.get("content-type") || "" } }).formData(); } catch { throw new UploadError("Invalid upload details."); }
  const thumbnail = form.get("thumbnail");
  if (!(thumbnail instanceof File) || thumbnail.size < 1 || thumbnail.size > MAX_THUMB_BYTES) throw new UploadError("A valid image preview is required.");
  const previewInput = new Uint8Array(await thumbnail.arrayBuffer());
  if (sniffImage(previewInput) !== "image/webp") throw new UploadError("A valid WebP preview is required.");
  let preview: Uint8Array; try { preview = stripMetadata(previewInput, "image/webp"); } catch { throw new UploadError("The image preview is damaged."); }
  let parts: R2UploadedPart[];
  try { parts = JSON.parse(String(form.get("parts"))); } catch { throw new UploadError("Invalid upload parts."); }
  const count = Math.ceil(session.bytes / UPLOAD_PART_BYTES);
  // R2 part etags are opaque tokens, including longer tokens in local storage.
  if (!Array.isArray(parts) || parts.length !== count || parts.some((part, i) => !part || part.partNumber !== i + 1 || typeof part.etag !== "string" || !/^[\x21-\x7e]{1,512}$/.test(part.etag))) throw new UploadError("Invalid upload parts.");
  const lock = await env.DB!.prepare("UPDATE uploads SET state = 'processing' WHERE id = ? AND state = 'uploading'").bind(id).run();
  if (!lock.meta.changes) throw new UploadError("This upload is already being processed. Try again shortly.", 409);
  locked = session;
  const complete = await env.BUCKET!.resumeMultipartUpload(`${id}/original`, session.upload_id).complete(parts);
  if (complete.size !== session.bytes) throw new UploadError("The uploaded file size is incorrect.");
  const original = await env.BUCKET!.get(`${id}/original`);
  if (!original) throw new UploadError("The image could not be read.");
  try { await validateImageStream(original.body, original.size, session.mime, session.width, session.height); }
  catch (error) { throw new UploadError(error instanceof Error ? error.message : "The image is invalid."); }
  await env.BUCKET!.put(`${id}/thumbnail`, preview, { httpMetadata: { contentType: "image/webp" } });
  const info = metadata({ title: form.get("title"), caption: form.get("caption"), tags: form.get("tags") });
  await env.DB!.batch([
   env.DB!.prepare("INSERT INTO images (id,title,caption,tags,mime,width,height,bytes,created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(id,info.title,info.caption,info.tags,session.mime,session.width,session.height,complete.size+preview.byteLength,Date.now()),
   env.DB!.prepare("DELETE FROM uploads WHERE id = ?").bind(id),
  ]);
  return Response.json({ id }, { status: 201 });
 } catch (error) {
  if (locked) await discardUpload(locked).catch(() => {});
  return uploadError(error);
 }
}
export async function DELETE(request: Request, context: Context) {
 const id = await access(request, context); if (id instanceof Response) return id;
 try {
  const session = await env.DB!.prepare("SELECT * FROM uploads WHERE id = ?").bind(id).first<UploadSession>();
  if (!session) return Response.json({ ok: true });
  const lock = await env.DB!.prepare("UPDATE uploads SET state = 'aborted' WHERE id = ? AND state = 'uploading'").bind(id).run();
  if (!lock.meta.changes) throw new UploadError("The upload is being processed.", 409);
  await discardUpload(session); return Response.json({ ok: true });
 } catch (error) { return uploadError(error); }
}
