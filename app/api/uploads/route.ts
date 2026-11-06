import { env } from "cloudflare:workers";
import { authorizeWrite } from "@/lib/auth";
import { IMAGE_TYPES, MAX_IMAGE_BYTES, UPLOAD_PART_BYTES } from "@/lib/images";
import { boundedBody, cleanExpiredUploads, UploadError, uploadError } from "@/lib/uploads";
export async function POST(request: Request) {
 const denied = await authorizeWrite(request); if (denied) return denied;
 if (!env.DB || !env.BUCKET) return Response.json({ error: "Gallery storage is unavailable." }, { status: 503 });
 try {
  let data; try { data = JSON.parse(new TextDecoder().decode(await boundedBody(request, 4096))); } catch (e) { if (e instanceof UploadError) throw e; throw new UploadError("Invalid upload details."); }
  const { mime, width, height, bytes } = data || {};
  if (!IMAGE_TYPES.includes(mime)) throw new UploadError("Use a JPG, PNG, or WebP image.");
  if (!Number.isInteger(bytes) || bytes < 1 || bytes > MAX_IMAGE_BYTES) throw new UploadError("Images must be 100 MB or smaller.", 413);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 30000 || height > 30000 || width * height > 100000000) throw new UploadError("Image dimensions are too large or invalid.");
  await cleanExpiredUploads();
  const id = crypto.randomUUID();
  const upload = await env.BUCKET.createMultipartUpload(`${id}/original`, { httpMetadata: { contentType: mime } });
  try { await env.DB.prepare("INSERT INTO uploads (id,upload_id,mime,width,height,bytes,state,created_at) VALUES (?,?,?,?,?,?,'uploading',?)").bind(id, upload.uploadId, mime, width, height, bytes, Date.now()).run(); }
  catch (error) { await upload.abort().catch(() => {}); throw error; }
  return Response.json({ id, partBytes: UPLOAD_PART_BYTES }, { status: 201 });
 } catch (error) { return uploadError(error); }
}
