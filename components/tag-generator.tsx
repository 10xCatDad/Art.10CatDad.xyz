"use client";
import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Sparkles } from "lucide-react";
import { parseTags } from "@/lib/tags";
export function TagGenerator({ imageId, onTags }: { imageId: string; onTags: (tags: string[]) => void }) {
 const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState(false);
 const active = useRef<AbortController | null>(null);
 useEffect(() => () => active.current?.abort(), []);
 async function generate() {
  if (active.current) return;
  const controller = new AbortController(); active.current = controller;
  setBusy(true); setMessage(""); setError(false);
  const timer = setTimeout(() => controller.abort(new Error("Tag generation timed out. Try again.")), 185_000);
  try {
   let method = "POST";
   while (!controller.signal.aborted) {
    const response = await fetch(`/api/images/${imageId}/tags`, { method, signal: controller.signal });
    const result = await response.json() as { state?: string; tags?: unknown; error?: string };
    if (!response.ok || result.state === "error") throw new Error(result.error || "Could not generate tags.");
    if (result.state === "done") { onTags(parseTags({ tags: result.tags })); setMessage("Tags added. Review, then save."); break; }
    if (!["pending", "running"].includes(result.state || "")) throw new Error("Tag generation stopped. Try again.");
    await new Promise<void>((resolve, reject) => {
     const done = () => { clearTimeout(wait); controller.signal.removeEventListener("abort", abort); resolve(); };
     const abort = () => { clearTimeout(wait); controller.signal.removeEventListener("abort", abort); reject(controller.signal.reason); };
     const wait = setTimeout(done, 1500); controller.signal.addEventListener("abort", abort, { once: true });
    });
    method = "GET";
   }
  } catch (reason) {
   if (!controller.signal.aborted || controller.signal.reason?.message?.includes("timed out")) { setError(true); setMessage(reason instanceof Error ? reason.message : "Could not generate tags."); }
  } finally { clearTimeout(timer); if (!controller.signal.aborted || controller.signal.reason?.message?.includes("timed out")) setBusy(false); active.current = null; }
 }
 return <div className="tag-generator"><button type="button" className="button small" disabled={busy} onClick={() => void generate()}>{busy ? <LoaderCircle size={15} className="spin"/> : <Sparkles size={15}/>} {busy ? "Generating tags…" : "Generate tags"}</button>{message && <p className={error ? "form-error" : "fine-print"} role={error ? "alert" : "status"}>{message}</p>}</div>;
}
