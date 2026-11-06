import { mergeTags, TAG_JOB_TIMEOUT } from "@/lib/tags";

// Pending work has no deadline. Only a claimed job can time out.
export function queueTagStatement(db: D1Database, where: string, values: (string | number)[] = []) {
 const now = Date.now();
 return db.prepare(`INSERT INTO image_tag_jobs (image_id,state,tags,requested_at)
  SELECT id,'pending','',? FROM images WHERE ${where}
  ON CONFLICT(image_id) DO UPDATE SET state='pending',tags='',requested_at=excluded.requested_at,started_at=NULL,lease=NULL
  WHERE image_tag_jobs.state IN ('done','error') OR (image_tag_jobs.state='running' AND COALESCE(image_tag_jobs.started_at,image_tag_jobs.requested_at) < ?)`)
  .bind(now, ...values, now - TAG_JOB_TIMEOUT);
}

export async function tagQueueStatus(db: D1Database, configured: boolean) {
 const now = Date.now();
 const [counts, heartbeat, untagged] = await Promise.all([
  db.prepare(`SELECT
   COUNT(CASE WHEN state='pending' THEN 1 END) AS pending,
   COUNT(CASE WHEN state='running' AND COALESCE(started_at,requested_at)>=? THEN 1 END) AS running,
   COUNT(CASE WHEN state='error' OR (state='running' AND COALESCE(started_at,requested_at)<?) THEN 1 END) AS failed,
   COUNT(CASE WHEN state='done' THEN 1 END) AS done
   FROM image_tag_jobs WHERE image_id IN (SELECT id FROM images)`).bind(now - TAG_JOB_TIMEOUT, now - TAG_JOB_TIMEOUT).first(),
  db.prepare("SELECT value FROM settings WHERE key='tagger_heartbeat'").first<{ value: string }>(),
  db.prepare("SELECT COUNT(*) AS total FROM images WHERE trim(tags)=''").first<{ total: number }>(),
 ]);
 return { ...counts, untagged: untagged?.total || 0, online: configured && !!heartbeat && Number(heartbeat.value) >= now - 90_000 };
}

export async function completeTagJob(db: D1Database, id: string, lease: string, tags: string[]) {
 // Compare and retry so an owner edit during generation is never overwritten.
 for (let attempt = 0; attempt < 5; attempt++) {
  const image = await db.prepare("SELECT tags FROM images WHERE id=?").bind(id).first<{ tags: string }>();
  if (!image) return false;
  const merged = mergeTags(image.tags, tags), cutoff = Date.now() - TAG_JOB_TIMEOUT;
  const result = await db.batch([
   db.prepare(`UPDATE images SET tags=? WHERE id=? AND tags=? AND EXISTS
    (SELECT 1 FROM image_tag_jobs WHERE image_id=? AND lease=? AND state='running' AND started_at>?)`)
    .bind(merged, id, image.tags, id, lease, cutoff),
   db.prepare(`UPDATE image_tag_jobs SET state='done',tags=? WHERE image_id=? AND lease=? AND state='running' AND started_at>?
    AND EXISTS (SELECT 1 FROM images WHERE id=? AND tags=?)`)
    .bind(JSON.stringify({ tags }), id, lease, cutoff, id, merged),
  ]);
  if (result[1].meta.changes) return true;
  const job = await db.prepare("SELECT state FROM image_tag_jobs WHERE image_id=? AND lease=?").bind(id, lease).first<{ state: string }>();
  if (!job || job.state !== "running") return job?.state === "done";
 }
 return false;
}
