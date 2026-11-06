import { env } from "cloudflare:workers";
export async function authorizeTagger(request: Request): Promise<boolean> {
 const expected = env.TAGGER_TOKEN;
 const provided = request.headers.get("authorization")?.replace(/^Bearer /, "");
 if (!expected || expected.length < 32 || !provided || provided.length > 256) return false;
 const encoder = new TextEncoder();
 const [a, b] = await Promise.all([expected, provided].map(value => crypto.subtle.digest("SHA-256", encoder.encode(value))));
 const left = new Uint8Array(a), right = new Uint8Array(b);
 let different = 0; for (let i = 0; i < left.length; i++) different |= left[i] ^ right[i];
 return different === 0;
}
