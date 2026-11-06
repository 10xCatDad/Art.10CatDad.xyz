import { env } from "cloudflare:workers";
import { authorizeWrite } from "@/lib/auth";
import { isImageId } from "@/lib/images";
import { chunks, imageIds, readBulkBody } from "@/lib/bulk";
export async function POST(request: Request) {
 const denied = await authorizeWrite(request); if (denied) return denied;
 if (!env.DB) return Response.json({ error: "Storage unavailable." }, { status: 503 });
 const input = await readBulkBody(request), ids = imageIds(input?.ids);
 if (!input || !ids) return Response.json({ error: "Select up to 1,000 images." }, { status: 400 });
 if (input.action !== "favorite" && input.action !== "addToAlbum" && input.action !== "removeFromAlbum") return Response.json({ error: "Invalid action." }, { status: 400 });
 if (input.action === "favorite" && typeof input.favorite !== "boolean") return Response.json({ error: "Choose a favorite state." }, { status: 400 });
 const album = input.album;
 if (input.action !== "favorite" && (typeof album !== "string" || !isImageId(album) || !await env.DB.prepare("SELECT id FROM albums WHERE id=?").bind(album).first())) return Response.json({ error: "Album not found." }, { status: 404 });
 const statements = chunks(ids).map(group => {
  const placeholders = group.map(() => "?").join(",");
  if (input.action === "favorite") return env.DB!.prepare(`UPDATE images SET favorite=? WHERE id IN (${placeholders})`).bind(input.favorite ? 1 : 0, ...group);
  if (input.action === "addToAlbum") return env.DB!.prepare(`INSERT OR IGNORE INTO album_images (album_id,image_id) SELECT ?,id FROM images WHERE id IN (${placeholders}) AND EXISTS (SELECT 1 FROM albums WHERE id=?)`).bind(album, ...group, album);
  return env.DB!.prepare(`DELETE FROM album_images WHERE album_id=? AND image_id IN (${placeholders})`).bind(album, ...group);
 });
 await env.DB.batch(statements);
 return Response.json({ ok: true });
}
