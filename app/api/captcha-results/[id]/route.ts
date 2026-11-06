import { env } from "cloudflare:workers";
import { uploadCaptchaResult } from "@/lib/captcha-results";
export const dynamic = "force-dynamic";
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  return uploadCaptchaResult(request, (await context.params).id, env);
}
