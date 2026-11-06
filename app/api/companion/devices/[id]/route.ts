import { env } from "cloudflare:workers";
import { authorizeOwnerWrite } from "@/lib/auth";
import { deviceReply } from "@/lib/device-auth";
import { isImageId } from "@/lib/images";
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
 const denied = await authorizeOwnerWrite(request); if (denied) return denied;
 const { id } = await context.params;
 if (!isImageId(id)) return deviceReply({ error: "Device not found." }, 404);
 await env.DB!.prepare("DELETE FROM companion_devices WHERE id = ?").bind(id).run();
 return deviceReply({ ok: true });
}
