import { isImageId } from "@/lib/images";
export function imageIds(value: unknown): string[] | null {
 if (!Array.isArray(value) || !value.length || value.length > 1000 || value.some(id => typeof id !== "string" || !isImageId(id))) return null;
 return [...new Set(value)] as string[];
}
export function chunks<T>(values: T[], size = 80): T[][] {
 return Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));
}
export async function readBulkBody(request: Request): Promise<Record<string, unknown> | null> {
 if (Number(request.headers.get("content-length")) > 50000) return null;
 const reader = request.body?.getReader(); if (!reader) return null;
 try {
  let text = "", size = 0; const decoder = new TextDecoder();
  while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 50000) return null; text += decoder.decode(value, { stream: true }); }
  const input = JSON.parse(text + decoder.decode());
  return input && typeof input === "object" && !Array.isArray(input) ? input : null;
 } catch { return null; } finally { await reader.cancel(); }
}
