import { env } from "cloudflare:workers";
import { authorizeOwnerWrite, isOwner } from "@/lib/auth";
import { DEVICE_LIFETIME, deviceReply, hashDeviceToken, newDeviceToken } from "@/lib/device-auth";
import { boundedBody } from "@/lib/uploads";
export const dynamic = "force-dynamic";
export async function GET() {
 if (!await isOwner()) return deviceReply({ error: "Owner access only." }, 403);
 const devices = await env.DB!.prepare("SELECT id,name,created_at,expires_at,last_used_at FROM companion_devices WHERE expires_at > ? ORDER BY created_at DESC").bind(Date.now()).all();
 return deviceReply({ devices: devices.results });
}
export async function POST(request: Request) {
 const denied = await authorizeOwnerWrite(request); if (denied) return denied;
 let input: { name?: unknown };
 try { input = JSON.parse(new TextDecoder().decode(await boundedBody(request, 1024))); } catch { return deviceReply({ error: "Enter a device name." }, 400); }
 if (!input || typeof input.name !== "string" || !input.name.trim() || input.name.length > 60 || /[\u0000-\u001f]/.test(input.name)) return deviceReply({ error: "Use a device name of 1 to 60 characters." }, 400);
 const now = Date.now(), id = crypto.randomUUID(), token = newDeviceToken();
 await env.DB!.prepare("DELETE FROM companion_devices WHERE expires_at <= ?").bind(now).run();
 const result = await env.DB!.prepare("INSERT INTO companion_devices (id,name,token_hash,created_at,expires_at) SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM companion_devices) < 10").bind(id, input.name.trim(), await hashDeviceToken(token), now, now + DEVICE_LIFETIME).run();
 if (!result.meta.changes) return deviceReply({ error: "Remove an old device before connecting another." }, 409);
 return deviceReply({ token, device: { id, name: input.name.trim(), created_at: now, expires_at: now + DEVICE_LIFETIME, last_used_at: null } }, 201);
}
