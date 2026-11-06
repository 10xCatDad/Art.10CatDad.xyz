import { env } from "cloudflare:workers";
import { authorizeWrite } from "@/lib/auth";
import { isImageId } from "@/lib/images";
import { readBulkBody } from "@/lib/bulk";
type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, context: Context) {
 const denied = await authorizeWrite(request); if (denied) return denied;
 const { id } = await context.params;
 if (!env.DB || !isImageId(id)) return Response.json({ error: "Album not found." }, { status: 404 });
 const input = await readBulkBody(request), name = typeof input?.name === "string" ? input.name.trim() : "";
 if (!name || name.length > 100 || /[\x00-\x1f\x7f]/.test(name)) return Response.json({ error: "Use an album name between 1 and 100 characters." }, { status: 400 });
 const result = await env.DB.prepare("UPDATE albums SET name=? WHERE id=?").bind(name, id).run();
 return result.meta.changes ? Response.json({ ok: true }) : Response.json({ error: "Album not found." }, { status: 404 });
}
export async function DELETE(request: Request, context: Context) {
 const denied = await authorizeWrite(request); if (denied) return denied;
 const { id } = await context.params;
 if (!env.DB || !isImageId(id)) return Response.json({ error: "Album not found." }, { status: 404 });
 await env.DB.prepare("DELETE FROM albums WHERE id=?").bind(id).run();
 return Response.json({ ok: true });
}
