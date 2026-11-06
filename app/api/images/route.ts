import { env } from "cloudflare:workers";
import { authorizeWrite } from "@/lib/auth";
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
 return Response.json({ error: "Refresh the gallery to use the updated uploader." }, { status: 400 });
}
