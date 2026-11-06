import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { authenticateDevice } from "@/lib/device-auth";
// Verified owner identity bootstraps the stable, Site-specific subject ID.
export async function isOwner(): Promise<boolean> {
 const user = await getChatGPTUser();
 if (!user || !env.DB) return false;
 const owner = await env.DB.prepare("SELECT value FROM settings WHERE key = 'owner_id'").first<{ value: string }>();
 if (owner) return owner.value === user.userId;
 if (!env.OWNER_EMAIL || user.email.toLowerCase() !== env.OWNER_EMAIL.trim().toLowerCase()) return false;
 await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('owner_id', ?) ON CONFLICT(key) DO NOTHING").bind(user.userId).run();
 const pinned = await env.DB.prepare("SELECT value FROM settings WHERE key = 'owner_id'").first<{ value: string }>();
 return pinned?.value === user.userId;
}
export async function authorizeWrite(request: Request): Promise<Response | null> {
 if (request.headers.has("authorization")) {
  return await authenticateDevice(request, env.DB) ? null : Response.json({ error: "Reconnect this device from Manage devices." }, { status: 401 });
 }
 return authorizeOwnerWrite(request);
}
export async function authorizeOwnerWrite(request: Request): Promise<Response | null> {
 if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "Refresh the page and try again." }, { status: 403 });
 if (!await isOwner()) return Response.json({ error: "Only the gallery owner can change images." }, { status: 403 });
 return null;
}
