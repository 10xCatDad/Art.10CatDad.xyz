import { env } from "cloudflare:workers";
import { authorizeWrite, isOwner } from "@/lib/auth";
import { authenticateDevice } from "@/lib/device-auth";
import { chunks, imageIds, readBulkBody } from "@/lib/bulk";
import { queueTagStatement, tagQueueStatus } from "@/lib/tag-queue";
import { TAG_JOB_TIMEOUT } from "@/lib/tags";
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function GET(request: Request) {
 const allowed = request.headers.has("authorization") ? await authenticateDevice(request, env.DB) : await isOwner();
 if (!allowed) return reply({ error: "Only the gallery owner can generate tags." }, 403);
 if (!env.DB) return reply({ error: "Storage unavailable." }, 503);
 return reply(await tagQueueStatus(env.DB, !!env.TAGGER_TOKEN));
}
export async function POST(request: Request) {
 const denied = await authorizeWrite(request); if (denied) return denied;
 if (!env.DB) return reply({ error: "Storage unavailable." }, 503);
 const input = await readBulkBody(request);
 if (!input) return reply({ error: "Invalid selection." }, 400);
 const ids = imageIds(input.ids);
 if (input.scope !== "untagged" && input.scope !== "failed" && !ids) return reply({ error: "Select up to 1,000 images." }, 400);
 const statements = input.scope === "untagged" ? [queueTagStatement(env.DB, "trim(tags)=''")]
  : input.scope === "failed" ? [queueTagStatement(env.DB, "id IN (SELECT image_id FROM image_tag_jobs WHERE state='error' OR (state='running' AND COALESCE(started_at,requested_at)<?))", [Date.now() - TAG_JOB_TIMEOUT])]
  : chunks(ids!).map(group => queueTagStatement(env.DB!, `id IN (${group.map(() => "?").join(",")})`, group));
 const results = await env.DB.batch(statements);
 return reply({ queued: results.reduce((count, result) => count + result.meta.changes, 0), ...await tagQueueStatus(env.DB, !!env.TAGGER_TOKEN) }, 202);
}
