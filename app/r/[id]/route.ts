import { env } from "cloudflare:workers";
import { getCaptchaShare } from "@/lib/captcha-results";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return getCaptchaShare(request, (await context.params).id, env);
}
export const HEAD = GET;
