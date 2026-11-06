import { stripMetadata } from "@/lib/strip-metadata";
import { env } from "cloudflare:workers";
import { authorizeWrite } from "@/lib/auth";
import { metadata, sniffImage, MAX_IMAGE_BYTES, MAX_THUMB_BYTES } from "@/lib/images";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
 if (!env.DB) return Response.json({ error: "Gallery storage is unavailable." }, { status: 503 });
 const url = new URL(request.url), q = (url.searchParams.get("q") || "").trim().slice(0,160);
 const order = url.searchParams.get("sort") === "oldest" ? "created_at ASC, id ASC" : url.searchParams.get("sort") === "title" ? "title COLLATE NOCASE ASC, id ASC" : "created_at DESC, id DESC";
 const offset = Math.max(0,Math.min(1000000,Number.parseInt(url.searchParams.get("offset") || "0") || 0));
 const where = q ? "WHERE title LIKE ? ESCAPE '\\' OR caption LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\'" : "";
 const term = `%${q.replace(/[\\%_]/g,"\\$&")}%`, values = q ? [term,term,term] : [];
 const result = await env.DB.prepare(`SELECT * FROM images ${where} ORDER BY ${order} LIMIT 60 OFFSET ?`).bind(...values,offset).all();
 const stats = await env.DB.prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(bytes),0) AS bytes FROM images ${where}`).bind(...values).first<{ total: number; bytes: number }>();
 const total = stats?.total || 0;
 return Response.json({ items: result.results, total, bytes: stats?.bytes || 0, nextOffset: offset + result.results.length < total ? offset + result.results.length : null }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: Request) {
 const denied = await authorizeWrite(request); if (denied) return denied;
 if (!env.DB || !env.BUCKET) return Response.json({ error: "Gallery storage is unavailable." }, { status: 503 });
 if (Number(request.headers.get("content-length")) > MAX_IMAGE_BYTES + MAX_THUMB_BYTES + 65536) return Response.json({ error: "Images must be 25 MB or smaller." }, { status: 413 });
 let form: FormData;
 try { form = await request.formData(); } catch { return Response.json({ error: "Upload a valid image file." }, { status: 400 }); }
 const file = form.get("image"), thumb = form.get("thumbnail");
 if (!(file instanceof File) || !(thumb instanceof File) || !file.size || !thumb.size || file.size > MAX_IMAGE_BYTES || thumb.size > MAX_THUMB_BYTES) return Response.json({ error: "Images must be 25 MB or smaller, with a valid preview." }, { status: 400 });
 let original: Uint8Array = new Uint8Array(await file.arrayBuffer()), preview: Uint8Array = new Uint8Array(await thumb.arrayBuffer());
 const mime = sniffImage(new Uint8Array(original));
 if (!mime || sniffImage(new Uint8Array(preview)) !== "image/webp") return Response.json({ error: "Use a JPG, PNG, or WebP image." }, { status: 400 });
 try { original = stripMetadata(original, mime); preview = stripMetadata(preview, "image/webp"); } catch { return Response.json({ error: "The image file is damaged or unsupported." }, { status: 400 }); }
 const width = Number(form.get("width")), height = Number(form.get("height"));
 if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 30000 || height > 30000 || width * height > 100000000) return Response.json({ error: "Image dimensions are too large or invalid." }, { status: 400 });
 const id = crypto.randomUUID(), info = metadata({ title: form.get("title"), caption: form.get("caption"), tags: form.get("tags") });
 try {
  await env.BUCKET.put(`${id}/original`,original,{ httpMetadata: { contentType: mime } });
  await env.BUCKET.put(`${id}/thumbnail`,preview,{ httpMetadata: { contentType: "image/webp" } });
  await env.DB.prepare("INSERT INTO images (id,title,caption,tags,mime,width,height,bytes,created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(id,info.title,info.caption,info.tags,mime,width,height,original.byteLength+preview.byteLength,Date.now()).run();
  return Response.json({ id }, { status: 201 });
 } catch (error) {
  await env.BUCKET.delete([`${id}/original`,`${id}/thumbnail`]).catch(() => {});
  console.error("Image upload failed",error instanceof Error ? error.message : "Storage error");
  return Response.json({ error: "The image could not be saved. Try uploading again." }, { status: 500 });
 }
}
