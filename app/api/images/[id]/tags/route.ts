import { env } from "cloudflare:workers";
import { authorizeWrite, isOwner } from "@/lib/auth";
import { isImageId } from "@/lib/images";
import { publicTagJob, TAG_JOB_TIMEOUT, type TagJob } from "@/lib/tags";
type Context = { params: Promise<{ id: string }> };
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function GET(_request: Request, context: Context) {
 if (!await isOwner()) return reply({ error: "Only the gallery owner can generate tags." }, 403);
 const { id } = await context.params;
 if (!isImageId(id) || !env.DB) return reply({ error: "Image not found." }, 404);
 const job = await env.DB.prepare("SELECT * FROM image_tag_jobs WHERE image_id = ?").bind(id).first<TagJob>();
 return job ? reply(publicTagJob(job)) : reply({ state: "idle", tags: [] });
}
export async function POST(request: Request, context: Context) {
 const denied = await authorizeWrite(request); if (denied) return denied;
 const { id } = await context.params, now = Date.now();
 if (!isImageId(id) || !env.DB || !await env.DB.prepare("SELECT id FROM images WHERE id = ?").bind(id).first()) return reply({ error: "Image not found." }, 404);
 const existing = await env.DB.prepare("SELECT * FROM image_tag_jobs WHERE image_id = ?").bind(id).first<TagJob>();
 if (existing && (existing.state === "done" || (["pending", "running"].includes(existing.state) && existing.requested_at >= now - TAG_JOB_TIMEOUT))) return reply(publicTagJob(existing), existing.state === "done" ? 200 : 202);
 const heartbeat = await env.DB.prepare("SELECT value FROM settings WHERE key = 'tagger_heartbeat'").first<{ value: string }>();
 if (!env.TAGGER_TOKEN || !heartbeat || Number(heartbeat.value) < now - 90_000) return reply({ error: "Tag generation is offline. Try again later." }, 503);
 const queued = await env.DB.prepare("SELECT COUNT(*) AS total FROM image_tag_jobs WHERE state IN ('pending','running') AND requested_at > ?").bind(now - TAG_JOB_TIMEOUT).first<{ total: number }>();
 if ((queued?.total || 0) >= 12) return reply({ error: "Several images are being tagged. Try again shortly." }, 429);
 await env.DB.prepare("INSERT INTO image_tag_jobs (image_id,state,tags,requested_at) VALUES (?,'pending','',?) ON CONFLICT(image_id) DO UPDATE SET state='pending',tags='',requested_at=excluded.requested_at,started_at=NULL,lease=NULL WHERE image_tag_jobs.state='error' OR image_tag_jobs.requested_at < ?").bind(id, now, now - TAG_JOB_TIMEOUT).run();
 return reply({ state: "pending", tags: [] }, 202);
}
