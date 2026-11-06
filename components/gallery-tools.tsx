"use client";
import { useEffect, useRef, useState } from "react";
import { FolderPlus, LoaderCircle, Pencil, Sparkles, Star, Trash2, X } from "lucide-react";
type Album = { id: string; name: string; count: number };
type Queue = { pending: number; running: number; failed: number; done: number; untagged: number; online: boolean };
type Props = {
 manage: boolean; ready: boolean; reload: number; album: string; tag: string; favorites: boolean;
 onAlbum: (id: string) => void; onTag: (tag: string) => void; onFavorites: (value: boolean) => void;
 selected: string[]; onSelectShown: () => void; onClear: () => void; onChanged: () => void;
};
async function request<T>(url: string, data?: unknown, method = "POST"): Promise<T> {
 const response = await fetch(url, data === undefined ? undefined : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
 const result = await response.json() as T & { error?: string };
 if (!response.ok) throw new Error(result.error || "Could not complete this action.");
 return result;
}
export function GalleryTools(props: Props) {
 const { manage, ready, reload, album, tag, favorites, onAlbum, onTag, onFavorites, selected, onSelectShown, onClear, onChanged } = props;
 const [albums, setAlbums] = useState<Album[]>([]), [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
 const [queue, setQueue] = useState<Queue | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
 const [targetAlbum, setTargetAlbum] = useState(""), [editingAlbum, setEditingAlbum] = useState<Album | "new" | null>(null), [name, setName] = useState("");
 const dialog = useRef<HTMLDialogElement>(null), actionLock = useRef(false), changed = useRef(onChanged), previousDone = useRef<number | null>(null);
 changed.current = onChanged;
 useEffect(() => {
  let active = true;
  Promise.all([request<{ albums: Album[] }>("/api/albums"), request<{ tags: { tag: string; count: number }[] }>("/api/images/facets")])
   .then(([a, t]) => { if (active) { setAlbums(a.albums); setTags(t.tags); } }).catch(e => { if (active) setError(e.message); });
  return () => { active = false; };
 }, [reload]);
 useEffect(() => {
  if (!manage) return;
  const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
  async function poll() {
   try {
    const response = await fetch("/api/tags", { signal: controller.signal });
    const next = await response.json() as Queue & { error?: string };
    if (!response.ok) throw new Error(next.error || "Could not check tagging progress.");
    if (controller.signal.aborted) return;
    setQueue(next);
    if (previousDone.current !== null && previousDone.current !== next.done) changed.current();
    previousDone.current = next.done;
   } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not check tagging progress."); }
   finally { if (!controller.signal.aborted) timer = setTimeout(poll, 3000); }
  }
  void poll(); return () => { controller.abort(); clearTimeout(timer); };
 }, [manage, reload]);
 useEffect(() => { if (editingAlbum) dialog.current?.showModal(); else dialog.current?.close(); }, [editingAlbum]);
 async function act(work: () => Promise<void>) {
  if (actionLock.current) return;
  actionLock.current = true; setBusy(true); setError("");
  try { await work(); } catch (e) { setError(e instanceof Error ? e.message : "Could not complete this action."); }
  finally { actionLock.current = false; setBusy(false); }
 }
 async function generate(scope?: "untagged" | "failed") {
  await act(async () => { setQueue(await request<Queue>("/api/tags", scope ? { scope } : { ids: selected })); });
 }
 const currentAlbum = albums.find(item => item.id === album);
 const filters = !!(album || tag || favorites);
 return <>
  <div className="collection-filters" aria-label="Filter images">
   <button disabled={!ready} className={`button small ${favorites ? "active-filter" : ""}`} aria-pressed={favorites} onClick={() => onFavorites(!favorites)}><Star size={15} fill={favorites ? "currentColor" : "none"}/> Favorites</button>
   <select disabled={!ready} aria-label="Filter by album" value={album} onChange={e => onAlbum(e.target.value)}><option value="">All albums</option>{albums.map(a => <option key={a.id} value={a.id}>{a.name} ({a.count})</option>)}</select>
   <select disabled={!ready} aria-label="Filter by tag" value={tag} onChange={e => onTag(e.target.value)}><option value="">All tags</option><option value="__untagged">Untagged</option>{tags.map(t => <option key={t.tag} value={t.tag}>{t.tag} ({t.count})</option>)}</select>
   {filters && <button className="button quiet small" onClick={() => { onAlbum(""); onTag(""); onFavorites(false); }}>Clear filters</button>}
   {manage && <button disabled={!ready} className="button quiet small" onClick={() => { setName(""); setEditingAlbum("new"); }}><FolderPlus size={15}/> New album</button>}
   {manage && currentAlbum && <><button className="icon-button" aria-label="Rename album" onClick={() => { setName(currentAlbum.name); setEditingAlbum(currentAlbum); }}><Pencil size={15}/></button><button className="icon-button" aria-label="Delete album" disabled={busy} onClick={() => {
    if (window.confirm(`Delete album “${currentAlbum.name}”? Its images will stay in the gallery.`)) void act(async () => { await request(`/api/albums/${album}`, {}, "DELETE"); onAlbum(""); onChanged(); });
   }}><Trash2 size={15}/></button></>}
  </div>
  {manage && <section className="bulk-tools" aria-label="Organize images">
   <div className="bulk-row"><strong>{selected.length} selected</strong><button className="button quiet small" onClick={onSelectShown}>Select shown</button>{selected.length > 0 && <button className="button quiet small" onClick={onClear}>Clear selection</button>}<span className="bulk-spacer"/>
    <button className="button small" disabled={busy || !selected.length} onClick={() => void generate()}><Sparkles size={15}/> Generate tags for selected</button>
    <button className="button primary small" disabled={busy || !queue?.untagged} onClick={() => void generate("untagged")}><Sparkles size={15}/> All untagged{queue ? ` (${queue.untagged})` : ""}</button>
   </div>
   {selected.length > 0 && <div className="bulk-row">
    <button className="button small" disabled={busy} onClick={() => void act(async () => { await request("/api/images/bulk", { action: "favorite", ids: selected, favorite: true }); onChanged(); })}><Star size={15}/> Favorite selected</button>
    <button className="button quiet small" disabled={busy} onClick={() => void act(async () => { await request("/api/images/bulk", { action: "favorite", ids: selected, favorite: false }); onChanged(); })}>Unfavorite selected</button>
    <select aria-label="Album for selected images" value={targetAlbum} onChange={e => setTargetAlbum(e.target.value)}><option value="">Choose album</option>{albums.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
    <button className="button small" disabled={busy || !targetAlbum} onClick={() => void act(async () => { await request("/api/images/bulk", { action: "addToAlbum", ids: selected, album: targetAlbum }); onChanged(); })}>Add to album</button>
    {album && <button className="button quiet small" disabled={busy} onClick={() => void act(async () => { await request("/api/images/bulk", { action: "removeFromAlbum", ids: selected, album }); onClear(); onChanged(); })}>Remove from this album</button>}
   </div>}
   <p className="fine-print">New uploads are tagged automatically. Generated tags save automatically.</p>
   {queue && <div className="tag-progress" role="status">{queue.pending + queue.running > 0 && <><LoaderCircle size={14} className={queue.online ? "spin" : ""}/><span>{queue.pending} queued // {queue.running} generating. {queue.online ? "You can leave this page." : "Waiting for the tagger to come online."}</span></>}{queue.failed > 0 && <><span>{queue.failed} failed.</span><button className="button quiet small" disabled={busy} onClick={() => void generate("failed")}>Retry failed</button></>}</div>}
  </section>}
  {error && <div className="error-banner" role="alert">{error}<button className="icon-button" aria-label="Dismiss error" onClick={() => setError("")}><X size={16}/></button></div>}
  <dialog ref={dialog} className="edit-dialog" aria-labelledby="album-title" onCancel={() => setEditingAlbum(null)}>
   <form onSubmit={e => { e.preventDefault(); void act(async () => { const result = await request<Album>(editingAlbum === "new" ? "/api/albums" : `/api/albums/${editingAlbum?.id}`, { name }, editingAlbum === "new" ? "POST" : "PATCH"); if (editingAlbum === "new") setTargetAlbum(result.id); setEditingAlbum(null); onChanged(); }); }}>
    <div className="edit-heading"><h2 id="album-title">{editingAlbum === "new" ? "New album" : "Rename album"}</h2><button type="button" className="icon-button" aria-label="Close album editor" disabled={busy} onClick={() => setEditingAlbum(null)}><X size={20}/></button></div>
    <label>Album name<input autoFocus required maxLength={100} value={name} onChange={e => setName(e.target.value)}/></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="button primary" disabled={busy || !name.trim()}>{busy && <LoaderCircle size={15} className="spin"/>}{editingAlbum === "new" ? "Create album" : "Save album"}</button>
   </form>
  </dialog>
 </>;
}
