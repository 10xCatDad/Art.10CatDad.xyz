import { env } from "cloudflare:workers";
import { authorizeWrite } from "@/lib/auth";
import { readBulkBody } from "@/lib/bulk";
export async function GET() {
 if (!env.DB) return Response.json({ error: "Storage unavailable." }, { status: 503 });
 const result = await env.DB.prepare("SELECT albums.*,COUNT(album_images.image_id) AS count FROM albums LEFT JOIN album_images ON albums.id=album_images.album_id GROUP BY albums.id ORDER BY name COLLATE NOCASE,id").all();
 return Response.json({ albums: result.results }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: Request) {
 const denied = await authorizeWrite(request); if (denied) return denied;
 if (!env.DB) return Response.json({ error: "Storage unavailable." }, { status: 503 });
 const input = await readBulkBody(request), name = typeof input?.name === "string" ? input.name.trim() : "";
 if (!name || name.length > 100 || /[\x00-\x1f\x7f]/.test(name)) return Response.json({ error: "Use an album name between 1 and 100 characters." }, { status: 400 });
 const id = crypto.randomUUID();
 await env.DB.prepare("INSERT INTO albums (id,name,created_at) VALUES (?,?,?)").bind(id, name, Date.now()).run();
 return Response.json({ id, name, count: 0 }, { status: 201 });
}
