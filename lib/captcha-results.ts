import { cleanResultPng, MAX_RESULT_BYTES } from "./result-png.ts";

type ResultEnv = { BUCKET?: R2Bucket; RESULT_IMAGE_TOKEN?: string };
export const RESULT_ORIGIN = "https://art.10xcatdad.xyz";
const isId = (value: string) => /^[a-f0-9]{64}$/.test(value);
const key = (id: string) => `results/${id}.png`;
const headers = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow, noarchive" };
const error = (status: number) => new Response(status === 404 ? "Not found" : "Result image unavailable", { status, headers: { ...headers, "Cache-Control": "no-store" } });
async function authorized(request: Request, expected?: string) {
  const supplied = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!expected || expected.length < 32 || !supplied || supplied.length > 256) return false;
  const digests = await Promise.all([expected, supplied].map(value => crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
  const [a,b] = digests.map(value => new Uint8Array(value)); let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}
export async function uploadCaptchaResult(request: Request, id: string, env: ResultEnv) {
  if (!await authorized(request, env.RESULT_IMAGE_TOKEN)) return error(403);
  if (!isId(id)) return error(404);
  if (!env.BUCKET) return error(503);
  const state = request.headers.get("x-result-state") || "", submittedAt = Number(request.headers.get("x-result-time"));
  if (!["passed", "rejected", "error"].includes(state) || !Number.isSafeInteger(submittedAt) || submittedAt < 1 || submittedAt > Date.now() + 86_400_000) return error(400);
  if (await env.BUCKET.head(key(id))) return Response.json({ saved: true }, { headers: { ...headers, "Cache-Control": "no-store" } });
  if (request.headers.get("content-type")?.split(";")[0] !== "image/png") return error(415);
  if (Number(request.headers.get("content-length")) > MAX_RESULT_BYTES) return error(413);
  const reader = request.body?.getReader(); if (!reader) return error(400);
  const parts: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > MAX_RESULT_BYTES) { await reader.cancel(); return error(413); } parts.push(value); }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  let clean: Awaited<ReturnType<typeof cleanResultPng>>;
  try { clean = await cleanResultPng(bytes); } catch { return error(400); }
  // The separate prefix has no gallery database row, tags, count or listing.
  // The conditional write makes concurrent retries immutable and idempotent.
  await env.BUCKET.put(key(id), await clean.image.arrayBuffer(), { onlyIf: { etagDoesNotMatch: "*" }, httpMetadata: { contentType: "image/png" }, customMetadata: { state, submittedAt: String(submittedAt), width: String(clean.width), height: String(clean.height) } });
  return Response.json({ saved: true }, { headers: { ...headers, "Cache-Control": "no-store" } });
}
export async function getCaptchaImage(request: Request, id: string, env: ResultEnv) {
  if (!isId(id) || !env.BUCKET) return error(404);
  const object = await env.BUCKET.get(key(id)); if (!object) return error(404);
  const responseHeaders = { ...headers, "Content-Type": "image/png", "Content-Length": String(object.size), "Cache-Control": "public, max-age=31536000, immutable", "ETag": object.httpEtag, "Access-Control-Allow-Origin": "*", "Content-Disposition": "inline; filename=humansonly-result.png" };
  return new Response(request.method === "HEAD" ? null : object.body, { headers: responseHeaders });
}
export async function getCaptchaShare(request: Request, id: string, env: ResultEnv) {
  if (!isId(id) || !env.BUCKET) return error(404);
  const object = await env.BUCKET.head(key(id)); if (!object) return error(404);
  const state = object.customMetadata?.state, outcome = state === "passed" ? "PASS" : state === "rejected" ? "FAIL" : "CHECK UNAVAILABLE";
  const title = `HumansOnly // Level 1 // ${outcome}`, url = `${RESULT_ORIGIN}/r/${id}`, image = `${url}/image.png`;
  const dimension = (value?: string) => /^\d{1,4}$/.test(value || "") ? value : "1080";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><meta name="robots" content="noindex,nofollow,noarchive"><meta name="referrer" content="no-referrer"><meta property="og:type" content="website"><meta property="og:title" content="${title}"><meta property="og:description" content="Challenge I result // captcha.10xCatDad.xyz"><meta property="og:url" content="${url}"><meta property="og:image" content="${image}"><meta property="og:image:type" content="image/png"><meta property="og:image:width" content="${dimension(object.customMetadata?.width)}"><meta property="og:image:height" content="${dimension(object.customMetadata?.height)}"><meta property="og:image:alt" content="${title}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:site" content="@10xCatDad"><meta name="twitter:title" content="${title}"><meta name="twitter:image" content="${image}"><style>@font-face{font-family:Space;src:url('/fonts/space-grotesk-latin.woff2') format('woff2');font-weight:300 700}*{box-sizing:border-box}body{margin:0;background:#000;color:#dcffe5;font:16px Space,Arial,sans-serif}main{max-width:760px;margin:auto;padding:28px 18px}h1{font-size:24px;color:#54ff81}p{color:#93b69e;line-height:1.5}img{display:block;width:100%;height:auto;border:1px solid #254830}nav{display:flex;gap:20px;margin-top:20px}a{color:#54ff81}a:focus-visible{outline:2px solid #54ff81;outline-offset:5px}</style></head><body><main><h1>${title}</h1><p>Unlisted // anyone with this link can view the image.</p><img src="${image}" alt="${title}"><nav><a href="${image}" download="humansonly-result.png">SAVE IMAGE</a><a href="https://captcha.10xcatdad.xyz" rel="noreferrer">TRY HUMANSONLY</a></nav></main></body></html>`;
  return new Response(request.method === "HEAD" ? null : html, { headers: { ...headers, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=3600", "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'" } });
}
