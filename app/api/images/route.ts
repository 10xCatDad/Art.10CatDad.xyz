import { env } from "cloudflare:workers";
import { authorizeWrite } from "@/lib/auth";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
 if (!env.DB) return Response.json({ error: "Gallery storage is unavailable." }, { status: 503 });
 const url = new URL(request.url), q = (url.searchParams.get("q") || "").trim().slice(0,160);
 const orders: Record<string, string> = { oldest: "created_at ASC, id ASC", title: "title COLLATE NOCASE ASC, id ASC", tag: "CASE WHEN tags='' THEN 1 ELSE 0 END,tags COLLATE NOCASE ASC,created_at DESC,id DESC", favorites: "favorite DESC,created_at DESC,id DESC" };
 const order = orders[url.searchParams.get("sort") || ""] || "created_at DESC, id DESC";
 const limit = Math.max(1,Math.min(1000,Number.parseInt(url.searchParams.get("limit") || "60") || 60));
 const offset = Math.max(0,Math.min(1000000,Number.parseInt(url.searchParams.get("offset") || "0") || 0));
 const clauses: string[] = [], values: string[] = [];
 if (q) { const term = `%${q.replace(/[\\%_]/g,"\\$&")}%`; clauses.push("(title LIKE ? ESCAPE '\\' OR caption LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\')"); values.push(term,term,term); }
 if (url.searchParams.get("favorites") === "1") clauses.push("favorite=1");
 const album = url.searchParams.get("album"), tag = url.searchParams.get("tag");
 if (album) { clauses.push("id IN (SELECT image_id FROM album_images WHERE album_id=?)"); values.push(album); }
 if (tag) { clauses.push("instr(',' || replace(lower(tags), ', ', ',') || ',', ',' || lower(?) || ',')>0"); values.push(tag.slice(0,40)); }
 if (url.searchParams.get("untagged") === "1") clauses.push("trim(tags)=''");
 const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
 const result = await env.DB.prepare(`SELECT * FROM images ${where} ORDER BY ${order} LIMIT ? OFFSET ?`).bind(...values,limit,offset).all();
 const stats = await env.DB.prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(bytes),0) AS bytes FROM images ${where}`).bind(...values).first<{ total: number; bytes: number }>();
 const total = stats?.total || 0;
 return Response.json({ items: result.results, total, bytes: stats?.bytes || 0, nextOffset: offset + result.results.length < total ? offset + result.results.length : null }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: Request) {
 const denied = await authorizeWrite(request); if (denied) return denied;
 return Response.json({ error: "Refresh the gallery to use the updated uploader." }, { status: 400 });
}
