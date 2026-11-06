import { env } from "cloudflare:workers";
import { authorizeWrite, isOwner } from "@/lib/auth";
import { isImageId } from "@/lib/images";
import { publicTagJob, type TagJob } from "@/lib/tags";
import { queueTagStatement } from "@/lib/tag-queue";
import { authenticateDevice } from "@/lib/device-auth";
type Context = { params: Promise<{ id: string }> };
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function GET(request: Request, context: Context) {
 const allowed = request.headers.has("authorization") ? await authenticateDevice(request, env.DB) : await isOwner();
 if (!allowed) return reply({ error: "Only the gallery owner can generate tags." }, 403);
 const { id } = await context.params;
 if (!isImageId(id) || !env.DB) return reply({ error: "Image not found." }, 404);
 const job = await env.DB.prepare("SELECT * FROM image_tag_jobs WHERE image_id = ?").bind(id).first<TagJob>();
 return job ? reply(publicTagJob(job)) : reply({ state: "idle", tags: [] });
}
export async function POST(request: Request, context: Context) {
 const denied = await authorizeWrite(request); if (denied) return denied;
 const { id } = await context.params;
 if (!isImageId(id) || !env.DB || !await env.DB.prepare("SELECT id FROM images WHERE id = ?").bind(id).first()) return reply({ error: "Image not found." }, 404);
 await queueTagStatement(env.DB, "id=?", [id]).run();
 const job = await env.DB.prepare("SELECT * FROM image_tag_jobs WHERE image_id=?").bind(id).first<TagJob>();
 return reply(publicTagJob(job!), 202);
}
