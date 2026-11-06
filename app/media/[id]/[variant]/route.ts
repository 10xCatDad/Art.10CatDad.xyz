import { env } from "cloudflare:workers";
import { isImageId } from "@/lib/images";
export async function GET(request: Request, context: { params: Promise<{ id: string; variant: string }> }) {
 const { id,variant } = await context.params;
 if (!isImageId(id) || !["original","thumbnail"].includes(variant) || !env.DB || !env.BUCKET) return new Response("Not found",{ status: 404 });
 const item = await env.DB.prepare("SELECT title,mime FROM images WHERE id = ?").bind(id).first<{ title: string; mime: string }>();
 if (!item) return new Response("Not found",{ status: 404 });
 const object = await env.BUCKET.get(`${id}/${variant}`);
 if (!object) return new Response("Not found",{ status: 404 });
 const headers = new Headers({ "Content-Type": variant === "thumbnail" ? "image/webp" : item.mime, "Content-Length": String(object.size), "Cache-Control": "public, max-age=0, must-revalidate", "ETag": object.httpEtag, "X-Content-Type-Options": "nosniff" });
 if (new URL(request.url).searchParams.has("download")) {
  const ext = item.mime.split("/")[1].replace("jpeg","jpg");
  headers.set("Content-Disposition",`attachment; filename="art.${ext}"; filename*=UTF-8''${encodeURIComponent(item.title + "." + ext).replace(/'/g,"%27")}`);
 }
 if (request.headers.get("if-none-match") === object.httpEtag) return new Response(null,{ status: 304,headers });
 return new Response(object.body,{ headers });
}
