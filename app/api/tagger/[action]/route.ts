import { env } from "cloudflare:workers";
import { authorizeTagger } from "@/lib/tagger-auth";
import { isImageId } from "@/lib/images";
import { parseTags, TAG_JOB_TIMEOUT } from "@/lib/tags";
import { completeTagJob } from "@/lib/tag-queue";
type Context = { params: Promise<{ action: string }> };
export async function POST(request: Request, context: Context) {
 const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
 if (!await authorizeTagger(request)) return reply({ error: "Worker authentication required." }, 401);
 if (!env.DB) return reply({ error: "Storage unavailable." }, 503);
 const { action } = await context.params, now = Date.now();
 if (action === "heartbeat" || action === "next") {
  if (action === "heartbeat") {
   await env.DB.prepare("INSERT INTO settings (key,value) VALUES ('tagger_heartbeat',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(String(now)).run();
   await env.DB.prepare("DELETE FROM image_tag_jobs WHERE (state IN ('done','error') AND requested_at < ?) OR image_id NOT IN (SELECT id FROM images)").bind(now - 7 * 86400000).run();
   return reply({ ok: true });
  }
  const lease = crypto.randomUUID();
  const job = await env.DB.prepare("UPDATE image_tag_jobs SET state='running',started_at=?,lease=? WHERE image_id=(SELECT image_id FROM image_tag_jobs WHERE state='pending' AND image_id IN (SELECT id FROM images) ORDER BY requested_at,image_id LIMIT 1) AND state='pending' RETURNING image_id").bind(now, lease).first<{ image_id: string }>();
  return reply({ job: job ? { id: job.image_id, lease } : null });
 }
 if (action !== "complete") return reply({ error: "Not found." }, 404);
 if (Number(request.headers.get("content-length")) > 4096) return reply({ error: "Result too large." }, 413);
 let input: { id?: unknown; lease?: unknown; tags?: unknown; error?: unknown };
 try {
  const reader = request.body?.getReader(); if (!reader) return reply({ error: "Invalid result." }, 400);
  let size = 0, text = ""; const decoder = new TextDecoder();
  try { while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > 4096) return reply({ error: "Result too large." }, 413); text += decoder.decode(value, { stream: true }); } } finally { await reader.cancel(); }
  input = JSON.parse(text + decoder.decode());
 } catch { return reply({ error: "Invalid result." }, 400); }
 if (!input || typeof input !== "object" || typeof input.id !== "string" || !isImageId(input.id) || typeof input.lease !== "string" || !isImageId(input.lease)) return reply({ error: "Invalid result." }, 400);
 let tags: string[] = [];
 if (input.error !== true) { try { tags = parseTags({ tags: input.tags }); } catch { return reply({ error: "Invalid tags." }, 400); } }
 const changed = input.error === true
  ? (await env.DB.prepare("UPDATE image_tag_jobs SET state='error',tags='' WHERE image_id=? AND lease=? AND state='running' AND started_at > ? AND image_id IN (SELECT id FROM images)").bind(input.id, input.lease, now - TAG_JOB_TIMEOUT).run()).meta.changes
  : await completeTagJob(env.DB, input.id, input.lease, tags);
 if (!changed) {
  const done = await env.DB.prepare("SELECT image_id FROM image_tag_jobs WHERE image_id=? AND lease=? AND state IN ('done','error')").bind(input.id, input.lease).first();
  return done ? reply({ ok: true }) : reply({ error: "Job expired." }, 409);
 }
 return reply({ ok: true });
}
