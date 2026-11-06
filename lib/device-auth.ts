// Device keys grant media management only. Browser owner identity controls keys.
export type ArtDevice = { id: string; name: string; created_at: number; expires_at: number; last_used_at: number | null };
export const DEVICE_LIFETIME = 90 * 86400000;
export const DEVICE_TOKEN = /^art_device_[0-9a-f]{64}$/;
export async function hashDeviceToken(token: string) {
 const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
 return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
export function newDeviceToken() {
 return "art_device_" + Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");
}
export async function authenticateDevice(request: Request, db: D1Database | undefined, now = Date.now()): Promise<ArtDevice | null> {
 if (!db) return null;
 const origin = request.headers.get("origin");
 if (origin !== null && origin !== new URL(request.url).origin) return null;
 const token = request.headers.get("authorization")?.replace(/^Bearer /, "") || "";
 if (!DEVICE_TOKEN.test(token)) return null;
 const device = await db.prepare("SELECT id,name,created_at,expires_at,last_used_at FROM companion_devices WHERE token_hash = ? AND expires_at > ?").bind(await hashDeviceToken(token), now).first<ArtDevice>();
 if (device && (!device.last_used_at || device.last_used_at < now - 900000)) {
  await db.prepare("UPDATE companion_devices SET last_used_at = ? WHERE id = ?").bind(now, device.id).run();
 }
 return device;
}
export const deviceReply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" } });
