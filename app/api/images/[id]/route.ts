import { env } from "cloudflare:workers";
import { authorizeWrite } from "@/lib/auth";
import { metadata, isImageId } from "@/lib/images";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
 const { id } = await context.params;
 if (!isImageId(id) || !env.DB) return Response.json({ error: "Image not found." }, { status: 404 });
 const item = await env.DB.prepare("SELECT * FROM images WHERE id = ?").bind(id).first();
 return item ? Response.json(item,{ headers: { "Cache-Control": "no-store" } }) : Response.json({ error: "Image not found." },{ status: 404 });
}
export async function PATCH(request: Request, context: Context) {
 const denied = await authorizeWrite(request); if (denied) return denied;
 const { id } = await context.params;
 if (!isImageId(id) || !env.DB) return Response.json({ error: "Image not found." },{ status: 404 });
 if (Number(request.headers.get("content-length")) > 16384) return Response.json({ error: "Details are too long." },{ status: 413 });
 let input; try { input = await request.json(); } catch { return Response.json({ error: "Invalid image details." },{ status: 400 }); }
 if (!input || typeof input !== "object") return Response.json({ error: "Invalid image details." },{ status: 400 });
 const info = metadata(input);
 const result = await env.DB.prepare("UPDATE images SET title = ?,caption = ?,tags = ? WHERE id = ?").bind(info.title,info.caption,info.tags,id).run();
 return result.meta.changes ? Response.json({ ok: true }) : Response.json({ error: "Image not found." },{ status: 404 });
}
export async function DELETE(request: Request, context: Context) {
 const denied = await authorizeWrite(request); if (denied) return denied;
 const { id } = await context.params;
 if (!isImageId(id) || !env.DB || !env.BUCKET) return Response.json({ error: "Image not found." },{ status: 404 });
 await env.BUCKET.delete([`${id}/original`,`${id}/thumbnail`]);
 await env.DB.prepare("DELETE FROM images WHERE id = ?").bind(id).run();
 return Response.json({ ok: true });
}
