import { env } from "cloudflare:workers";
import { authenticateDevice, deviceReply } from "@/lib/device-auth";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
 const device = await authenticateDevice(request, env.DB);
 if (!device) return deviceReply({ error: "Reconnect this device from Manage devices." }, 401);
 const heartbeat = await env.DB!.prepare("SELECT value FROM settings WHERE key = 'tagger_heartbeat'").first<{ value: string }>();
 return deviceReply({ apiVersion: 1, device, taggerOnline: !!env.TAGGER_TOKEN && Number(heartbeat?.value || 0) > Date.now() - 90000 });
}
export async function DELETE(request: Request) {
 const device = await authenticateDevice(request, env.DB);
 if (!device) return deviceReply({ error: "This device is already disconnected." }, 401);
 await env.DB!.prepare("DELETE FROM companion_devices WHERE id = ?").bind(device.id).run();
 return deviceReply({ ok: true });
}
