import { env } from "cloudflare:workers";
export async function GET() {
 if (!env.DB) return Response.json({ error: "Storage unavailable." }, { status: 503 });
 const rows = await env.DB.prepare("SELECT tags,COUNT(*) AS count FROM images GROUP BY tags").all<{ tags: string; count: number }>();
 const counts = new Map<string, number>();
 for (const row of rows.results) for (const tag of new Set(row.tags.split(",").map(tag => tag.trim().toLowerCase()).filter(Boolean))) counts.set(tag, (counts.get(tag) || 0) + row.count);
 return Response.json({ tags: [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([tag, count]) => ({ tag, count })) }, { headers: { "Cache-Control": "no-store" } });
}
