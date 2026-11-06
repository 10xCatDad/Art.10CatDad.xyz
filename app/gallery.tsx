"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDownToLine, ArrowLeft, ArrowRight, Check, Copy, Grid2X2, ImagePlus, Images, LayoutGrid, LoaderCircle, LogOut, Monitor, Moon, Pencil, Search, Star, Sun, Trash2, Upload, X } from "lucide-react";
import { IMAGE_TYPES, MAX_IMAGE_BYTES, sniffImage, type ArtImage } from "@/lib/images";
import { needsTransparency, stripEncodedMetadata } from "@/lib/strip-encoded-metadata";
import { TagGenerator } from "@/components/tag-generator";
import { GalleryTools } from "@/components/gallery-tools";
import { mergeTags } from "@/lib/tags";

type Listing = { items: ArtImage[]; total: number; bytes: number; nextOffset: number | null };
type QueueItem = { name: string; state: "waiting" | "uploading" | "done" | "error"; error?: string; progress?: number };
const media = (item: ArtImage, variant = "thumbnail") => `/media/${item.id}/${variant}`;
const size = (bytes: number) => bytes > 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;

async function jsonRequest<T = unknown>(url: string, options?: RequestInit): Promise<T> {
 const response = await fetch(url, options);
 let data;
 try { data = await response.json(); } catch { throw new Error("The request could not be completed. Try again."); }
 if (!response.ok) throw new Error((data as { error?: string }).error || "The request could not be completed.");
 return data as T;
}

async function prepareUpload(file: File) {
 const mime = sniffImage(new Uint8Array(await file.slice(0,16).arrayBuffer()));
 if (!mime || !IMAGE_TYPES.includes(mime)) throw new Error("Use a JPG, PNG, or WebP image.");
 if (file.size > MAX_IMAGE_BYTES) throw new Error("This image is larger than 100 MB.");
 const bitmap = await createImageBitmap(file), canvas = document.createElement("canvas");
 try {
  if (bitmap.width * bitmap.height > 100000000 || bitmap.width > 30000 || bitmap.height > 30000) throw new Error("Use an image up to 100 megapixels and 30,000 pixels per side.");
  canvas.width = bitmap.width; canvas.height = bitmap.height;
  const context = canvas.getContext("2d", { alpha: await needsTransparency(file, mime) });
  if (!context) throw new Error("This browser cannot prepare images.");
  context.drawImage(bitmap, 0, 0);
  const encode = (type: string, quality?: number) => new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Image conversion failed.")), type, quality));
  // Pixel re-encoding drops EXIF, XMP, comments, filenames, and embedded prompts.
  const original = await stripEncodedMetadata(await encode(mime, .97));
  if (original.size > MAX_IMAGE_BYTES) throw new Error("The cleaned image is larger than 100 MB. Export a smaller copy and try again.");
  const scale = Math.min(1, 960 / Math.max(bitmap.width, bitmap.height));
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const thumbnail = await stripEncodedMetadata(await encode("image/webp", .82));
  return { original, thumbnail, width: bitmap.width, height: bitmap.height };
 } finally { canvas.width = canvas.height = 0; bitmap.close(); }
}

async function uploadPrepared(image: Awaited<ReturnType<typeof prepareUpload>>, onProgress: (progress: number) => void) {
 const { id, partBytes } = await jsonRequest<{ id: string; partBytes: number }>("/api/uploads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mime: image.original.type, bytes: image.original.size, width: image.width, height: image.height }) });
 try {
  const parts: { partNumber: number; etag: string }[] = [];
  for (let offset = 0; offset < image.original.size; offset += partBytes) {
   const partNumber = parts.length + 1, chunk = image.original.slice(offset, offset + partBytes);
   let part: { partNumber: number; etag: string } | undefined;
   for (let attempt = 0; attempt < 3; attempt++) {
    try { part = await jsonRequest(`/api/uploads/${id}?part=${partNumber}`, { method: "PUT", body: chunk }); break; }
    catch (error) { if (attempt === 2) throw error; await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1))); }
   }
   parts.push(part!); onProgress(Math.round(Math.min(offset + chunk.size, image.original.size) / image.original.size * 95));
  }
  const form = new FormData(); form.set("parts", JSON.stringify(parts)); form.set("thumbnail", image.thumbnail, "preview.webp"); form.set("title", "Untitled");
  await jsonRequest(`/api/uploads/${id}`, { method: "POST", body: form }); onProgress(100);
 } catch (error) {
  // Completion can succeed even when its response is lost. Never remove that image.
  try { const existing = await fetch(`/api/images/${id}`); if (existing.ok) { onProgress(100); return; } } catch {}
  await fetch(`/api/uploads/${id}`, { method: "DELETE" }).catch(() => {});
  throw error;
 }
}

export default function Gallery({ owner, manage, signOutPath }: { owner: boolean; manage: boolean; signOutPath?: string }) {
 const [items, setItems] = useState<ArtImage[]>([]);
 const [total, setTotal] = useState(0), [bytes, setBytes] = useState(0);
 const [nextOffset, setNextOffset] = useState<number | null>(null);
 const [query, setQuery] = useState(""), [sort, setSort] = useState("newest");
 const [album, setAlbum] = useState(""), [tag, setTag] = useState(""), [favorites, setFavorites] = useState(false);
 const [selected, setSelected] = useState<string[]>([]), [favoriteBusy, setFavoriteBusy] = useState<string[]>([]);
 const visibleCount = useRef(60), tagsEdited = useRef(false);
 const [dense, setDense] = useState(false), [theme, setTheme] = useState("system");
 const [loading, setLoading] = useState(true), [error, setError] = useState("");
 const [reload, setReload] = useState(0), [active, setActive] = useState<ArtImage | null>(null);
 const [editing, setEditing] = useState<ArtImage | null>(null), [saving, setSaving] = useState(false);
 const [editError, setEditError] = useState(""), [copied, setCopied] = useState(false);
 const [queue, setQueue] = useState<QueueItem[]>([]), [uploading, setUploading] = useState(false), [dragging, setDragging] = useState(false);
 const [pasteNotice, setPasteNotice] = useState("");
 const [ready, setReady] = useState(false);
 const tagInputRef = useRef<HTMLInputElement>(null);
 const inputRef = useRef<HTMLInputElement>(null), viewerRef = useRef<HTMLDialogElement>(null), editRef = useRef<HTMLDialogElement>(null);
 const uploadLock = useRef(false), version = useRef(0);
 const refresh = () => setReload(x => x + 1);

 useEffect(() => {
  try { setTheme(localStorage.getItem("art-theme") || "system"); setDense(localStorage.getItem("art-density") === "dense"); } catch {}
  const params = new URLSearchParams(location.search);
  setQuery(params.get("q") || ""); setAlbum(params.get("album") || ""); setFavorites(params.get("favorites") === "1");
  setTag(params.get("untagged") === "1" ? "__untagged" : params.get("tag") || "");
  const order = params.get("sort"); if (order && ["newest", "oldest", "title", "tag", "favorites"].includes(order)) setSort(order);
  setReady(true);
 }, []);
 useEffect(() => {
  if (!ready) return;
  const url = new URL(location.href);
  for (const [key, value] of Object.entries({ q: query, album, tag: tag === "__untagged" ? "" : tag, untagged: tag === "__untagged" ? "1" : "", favorites: favorites ? "1" : "", sort: sort === "newest" ? "" : sort })) {
   if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
  }
  history.replaceState(null, "", url);
 }, [ready, query, sort, album, tag, favorites]);
 useEffect(() => { visibleCount.current = 60; setSelected([]); }, [query, sort, album, tag, favorites]);
 const listingParams = () => new URLSearchParams({ q: query, sort, album, ...(tag === "__untagged" ? { untagged: "1" } : { tag }), favorites: favorites ? "1" : "0" });
 useEffect(() => {
  const controller = new AbortController(), current = ++version.current;
  setLoading(true); setError("");
  const timer = window.setTimeout(async () => {
   try {
    const data = await jsonRequest<Listing>(`/api/images?${listingParams()}&limit=${visibleCount.current}`, { signal: controller.signal });
    if (current !== version.current) return;
    setItems(data.items); setTotal(data.total); setBytes(data.bytes); setNextOffset(data.nextOffset);
   } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not load the gallery."); }
   finally { if (!controller.signal.aborted && current === version.current) setLoading(false); }
  }, query ? 220 : 0);
  return () => { controller.abort(); clearTimeout(timer); };
 }, [query, sort, album, tag, favorites, reload]);

 useEffect(() => {
  const id = new URLSearchParams(location.search).get("image");
  if (id) jsonRequest<ArtImage>(`/api/images/${encodeURIComponent(id)}`).then(setActive).catch(e => setError(e.message));
 }, []);

 const closeViewer = useCallback(() => { setActive(null); const url = new URL(location.href); url.searchParams.delete("image"); history.replaceState(null, "", url); }, []);
 const openImage = useCallback((item: ArtImage) => {
  setActive(item); setCopied(false);
  const url = new URL(location.href); url.searchParams.set("image", item.id); history.replaceState(null, "", url);
 }, []);
 useEffect(() => {
  const dialog = viewerRef.current;
  if (active && dialog && !dialog.open) dialog.showModal();
  if (!active && dialog?.open) dialog.close();
 }, [active]);
 useEffect(() => {
  const dialog = editRef.current;
  if (editing && dialog && !dialog.open) dialog.showModal();
  if (!editing && dialog?.open) dialog.close();
 }, [editing]);
 useEffect(() => {
  if (!active) return;
  const onKey = (event: KeyboardEvent) => {
   if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
   const index = items.findIndex(item => item.id === active.id);
   if (event.key === "ArrowRight" && index >= 0 && index < items.length - 1) { event.preventDefault(); openImage(items[index + 1]); }
   if (event.key === "ArrowLeft" && index > 0) { event.preventDefault(); openImage(items[index - 1]); }
  };
  document.addEventListener("keydown", onKey);
  return () => document.removeEventListener("keydown", onKey);
 }, [active, items, openImage]);

 async function more() {
  if (nextOffset === null || loading) return;
  const current = version.current;
  setLoading(true); setError("");
  try {
   const data = await jsonRequest<Listing>(`/api/images?${listingParams()}&offset=${nextOffset}`);
   if (current !== version.current) return;
   visibleCount.current += data.items.length;
   setItems(previous => [...previous, ...data.items.filter(item => !previous.some(p => p.id === item.id))]); setNextOffset(data.nextOffset); setTotal(data.total);
  } catch (e) { if (current === version.current) setError(e instanceof Error ? e.message : "Could not load more images."); }
  finally { if (current === version.current) setLoading(false); }
 }
 function changeTheme(value: string) { setTheme(value); document.documentElement.dataset.theme = value; try { localStorage.setItem("art-theme", value); } catch {} }
 function changeDensity(value: boolean) { setDense(value); try { localStorage.setItem("art-density", value ? "dense" : "comfortable"); } catch {} }

 const upload = useCallback(async (files: FileList | File[]) => {
  if (!owner || !manage || uploadLock.current || !files.length) return;
  const batch = Array.from(files);
  uploadLock.current = true; setUploading(true); setPasteNotice("");
  setQueue(batch.map(file => ({ name: file.name, state: "waiting" })));
  const update = (i: number, data: Partial<QueueItem>) => setQueue(rows => rows.map((row, n) => n === i ? { ...row, ...data } : row));
  try {
   for (let i = 0; i < batch.length; i++) {
    update(i, { state: "uploading", progress: 0 });
    try { const prepared = await prepareUpload(batch[i]); await uploadPrepared(prepared, progress => update(i, { progress })); update(i, { state: "done" }); setReload(x => x + 1); }
    catch (e) { update(i, { state: "error", error: e instanceof Error ? e.message : "Upload failed. Try again." }); }
   }
  } finally { uploadLock.current = false; setUploading(false); if (inputRef.current) inputRef.current.value = ""; }
 }, [owner, manage]);
 useEffect(() => {
  if (!owner || !manage || !ready) return;
  const onPaste = (event: ClipboardEvent) => {
   if (event.defaultPrevented || active || editing) return;
   // Leave normal editing and text/URL pastes entirely to the browser.
   if (event.composedPath().some(target => target instanceof HTMLElement && (target.isContentEditable || target.matches("input, textarea, select, [role=textbox]")))) return;
   const clipboard = event.clipboardData; if (!clipboard) return;
   const itemFiles = Array.from(clipboard.items).filter(item => item.kind === "file").map(item => item.getAsFile());
   const files = (itemFiles.length ? itemFiles : Array.from(clipboard.files)).filter((file): file is File => !!file && (file.type.startsWith("image/") || (!file.type && /\.(png|jpe?g|webp)$/i.test(file.name))));
   if (!files.length) return;
   event.preventDefault();
   if (uploadLock.current) { setPasteNotice("Finish the current upload, then paste again."); return; }
   void upload(files);
  };
  document.addEventListener("paste", onPaste);
  return () => document.removeEventListener("paste", onPaste);
 }, [owner, manage, ready, active, editing, upload]);
 async function save(event: React.FormEvent<HTMLFormElement>) {
  event.preventDefault(); if (!editing || saving) return;
  const form = new FormData(event.currentTarget); if (!tagsEdited.current) form.delete("tags"); setSaving(true); setEditError("");
  try { await jsonRequest(`/api/images/${editing.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(form)) }); setEditing(null); refresh(); }
  catch (e) { setEditError(e instanceof Error ? e.message : "Could not save changes."); } finally { setSaving(false); }
 }
 async function remove() {
  if (!editing || saving || !window.confirm(`Delete “${editing.title}” and its image file? This cannot be undone.`)) return;
  setSaving(true); setEditError("");
  try { await jsonRequest(`/api/images/${editing.id}`, { method: "DELETE" }); setEditing(null); refresh(); }
  catch (e) { setEditError(e instanceof Error ? e.message : "Could not delete the image."); } finally { setSaving(false); }
 }
 async function toggleFavorite(item: ArtImage) {
  if (favoriteBusy.includes(item.id)) return;
  setFavoriteBusy(ids => [...ids, item.id]);
  try {
   await jsonRequest("/api/images/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "favorite", ids: [item.id], favorite: !item.favorite }) });
   setActive(current => current?.id === item.id ? { ...current, favorite: item.favorite ? 0 : 1 } : current); refresh();
  } catch (e) { setError(e instanceof Error ? e.message : "Could not update favorite."); }
  finally { setFavoriteBusy(ids => ids.filter(id => id !== item.id)); }
 }
 function toggleSelected(id: string) { setSelected(ids => ids.includes(id) ? ids.filter(value => value !== id) : ids.length < 1000 ? [...ids, id] : ids); }
 const filtered = !!(query || album || tag || favorites);
 const activeIndex = active ? items.findIndex(item => item.id === active.id) : -1;

 return <>
  <header className="site-header">
   <a className="brand" href="/" aria-label="10xCatDad gallery home"><img src="/favicon.svg" width="32" height="32" alt=""/><span>10xCatDad<span className="brand-divider" aria-hidden="true">//</span><span className="brand-section">ART &amp; STUFF</span></span></a>
   <div className="header-actions">
    <div className="theme-switch" role="group" aria-label="Color theme">{[{ value: "system", label: "System theme", Icon: Monitor }, { value: "light", label: "Light theme", Icon: Sun }, { value: "dark", label: "Dark theme", Icon: Moon }].map(({ value, label, Icon }) => <button key={value} type="button" disabled={!ready} title={label} aria-label={label} aria-pressed={theme === value} onClick={() => changeTheme(value)}><Icon size={16}/></button>)}</div>
    {manage ? <a className="button quiet" href="/">View gallery</a> : owner ? <a className="button primary small" href="/manage"><Upload size={15}/> Add images</a> : null}
    {manage && <a className="button quiet" href="/manage/devices">Devices</a>}
    {signOutPath && <a className="button quiet sign-out" href={signOutPath} target="_top"><LogOut size={16}/> Log out</a>}
   </div>
  </header>
  <main className="main">
   <div className="page-heading"><div><p className="eyebrow">10xCatDad</p><h1>{manage ? "Manage gallery" : "ART & STUFF"}</h1>{manage && <p className="intro">Add images, edit details, and choose what appears here.</p>}</div><span className="collection-count">{loading && !items.length ? "" : `${total.toLocaleString()} ${total === 1 ? "image" : "images"}`}</span></div>
   {manage && <section className={`upload-area ${dragging ? "dragging" : ""}`} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }} onDrop={event => { event.preventDefault(); setDragging(false); void upload(event.dataTransfer.files); }} aria-label="Upload images">
    <div className="upload-symbol"><ImagePlus size={27}/></div><div className="upload-text"><h2>Drop or paste images here</h2><p>JPG, PNG or WebP // Up to 100 MB each</p><p className="fine-print">Paste with Ctrl+V or ⌘V. Images appear publicly after upload. Embedded metadata is removed.</p>{pasteNotice && <p className="fine-print" role="status">{pasteNotice}</p>}</div>
    <button className="button primary" onClick={() => inputRef.current?.click()} disabled={uploading || !ready}>{uploading ? <LoaderCircle className="spin" size={17}/> : <Upload size={17}/>} {uploading ? "Uploading…" : "Choose images"}</button>
    <input ref={inputRef} className="sr-only" type="file" disabled={!ready || uploading} accept="image/jpeg,image/png,image/webp" multiple onChange={event => event.target.files && void upload(event.target.files)} aria-label="Choose images to upload"/>
   </section>}
   {manage && queue.length > 0 && <section className="upload-queue" aria-label="Upload progress" aria-live="polite"><div className="queue-heading"><strong>{queue.filter(row => row.state === "done").length} of {queue.length} uploaded</strong>{!uploading && <button className="icon-button" aria-label="Dismiss upload progress" onClick={() => setQueue([])}><X size={16}/></button>}</div>{queue.map((row, i) => <div key={i} className={`queue-row ${row.state}`}><span>{row.state === "done" ? <Check size={16}/> : row.state === "uploading" ? <LoaderCircle size={16} className="spin"/> : row.state === "error" ? <X size={16}/> : <span className="queue-dot"/>}</span><span className="queue-name">{row.name}{row.error && <small>{row.error}</small>}</span><span className="muted">{row.state === "done" ? "Uploaded" : row.state === "waiting" ? "Waiting" : row.state === "uploading" ? `${row.progress || 0}%` : "Failed"}</span></div>)}</section>}
   <div className="toolbar"><label className="search"><Search size={18}/><input disabled={!ready} placeholder="Search images…" aria-label="Search images" value={query} onChange={event => setQuery(event.target.value)}/>{query && <button className="icon-button" onClick={() => setQuery("")} aria-label="Clear search"><X size={15}/></button>}</label><div className="view-controls"><select disabled={!ready} className="sort" aria-label="Sort images" value={sort} onChange={event => setSort(event.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="title">Title A–Z</option><option value="tag">Tag A–Z</option><option value="favorites">Favorites first</option></select><div className="density"><button className={dense ? "" : "selected"} onClick={() => changeDensity(false)} title="Large images" aria-label="Large images" aria-pressed={!dense}><Grid2X2 size={17}/></button><button className={dense ? "selected" : ""} onClick={() => changeDensity(true)} title="Small images" aria-label="Small images" aria-pressed={dense}><LayoutGrid size={17}/></button></div></div></div>
   <GalleryTools ready={ready} manage={manage} reload={reload} album={album} tag={tag} favorites={favorites} onAlbum={setAlbum} onTag={setTag} onFavorites={setFavorites} selected={selected} onSelectShown={() => setSelected(ids => [...new Set([...ids, ...items.map(item => item.id)])].slice(0, 1000))} onClear={() => setSelected([])} onChanged={refresh}/>
   {error && <div className="error-banner" role="alert"><span>{error}</span><button className="button quiet" onClick={refresh}>Retry</button></div>}
   {!error && loading && !items.length ? <div className="empty"><LoaderCircle className="spin" size={25}/><p>Loading images…</p></div> : !error && !items.length ? <div className="empty"><div className="empty-icon"><Images size={32} strokeWidth={1.3}/></div><h2>{filtered ? "No images found" : "No images yet"}</h2><p>{filtered ? "Try a different search or filter." : manage ? "Upload your first image to start the collection." : "New creations will appear here."}</p>{query ? <button className="button quiet" onClick={() => setQuery("")}>Clear search</button> : manage ? <button className="button quiet" onClick={() => inputRef.current?.click()}>Choose images <ArrowRight size={15}/></button> : null}</div> : <section className={`gallery-grid ${dense ? "dense" : ""}`} aria-label="Art gallery" aria-busy={loading}>{items.map(item => <article className={`art-card ${selected.includes(item.id) ? "is-selected" : ""}`} key={item.id}>{manage && <label className="select-image"><input type="checkbox" aria-label={`Select ${item.title}`} checked={selected.includes(item.id)} onChange={() => toggleSelected(item.id)}/><span className="sr-only">Select image</span></label>}<button className="image-button" aria-label={`View ${item.title}`} onClick={() => openImage(item)} style={{ aspectRatio: `${item.width}/${item.height}` }}><img src={media(item)} alt={item.title} width={item.width} height={item.height} loading="lazy" decoding="async"/><span className="image-hover">View image <ArrowRight size={16}/></span></button><div className="card-details"><button className="card-title" onClick={() => openImage(item)}>{item.title}</button>{manage && <button className="icon-button favorite-card" aria-label={`${item.favorite ? "Unfavorite" : "Favorite"} ${item.title}`} aria-pressed={!!item.favorite} disabled={favoriteBusy.includes(item.id)} onClick={() => void toggleFavorite(item)}><Star size={16} fill={item.favorite ? "currentColor" : "none"}/></button>}{!manage && !!item.favorite && <Star className="favorite-mark" size={14} aria-label="Favorite" fill="currentColor"/>}{manage && <button className="icon-button edit-card" aria-label={`Edit ${item.title}`} onClick={() => { setEditError(""); tagsEdited.current = false; setEditing(item); }}><Pencil size={14}/></button>}</div>{item.tags && <p className="card-tags">{item.tags}</p>}</article>)}</section>}
   {nextOffset !== null && <div className="load-more"><button className="button" disabled={loading} onClick={more}>{loading && <LoaderCircle className="spin" size={16}/>} {loading ? "Loading…" : "Load more"}</button><span className="muted">Showing {items.length} of {total}</span></div>}
  </main>
  <footer className="footer"><a className="footer-profile" href="https://x.com/10xCatDad" target="_blank" rel="noopener noreferrer" aria-label="10xCatDad on X"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3L12 14.6 5.5 22H2.3l7.3-8.5L1.4 2h6.4l5 7.1L18.9 2ZM17.8 20h1.8L6.8 3.9H4.9L17.8 20Z"/></svg>10xCatDad</a>{manage ? <span>{size(bytes)} stored</span> : <a href="/manage" target="_top">Manage gallery</a>}</footer>
  <dialog className="viewer" ref={viewerRef} aria-label={active?.title || "Image viewer"} onCancel={closeViewer} onClick={event => { if (event.target === event.currentTarget) closeViewer(); }}>
   {active && <><div className="viewer-top"><span>{activeIndex >= 0 ? `${activeIndex + 1} / ${items.length}` : "Image"}</span><div><span className="image-date">{new Date(active.created_at).toLocaleDateString()}</span>{manage && <button className="icon-button" aria-label={active.favorite ? "Unfavorite image" : "Favorite image"} aria-pressed={!!active.favorite} disabled={favoriteBusy.includes(active.id)} onClick={() => void toggleFavorite(active)}><Star size={20} fill={active.favorite ? "currentColor" : "none"}/></button>}<a className="icon-button" href={`${media(active, "original")}?download=1`} aria-label="Download image" title="Download image"><ArrowDownToLine size={20}/></a><button className="icon-button" aria-label="Copy image link" title="Copy image link" onClick={async () => { try { const url = new URL("/", location.origin); url.searchParams.set("image", active.id); await navigator.clipboard.writeText(url.href); setCopied(true); } catch { setError("Could not copy the link. Copy the address from your browser."); } }}>{copied ? <Check size={20}/> : <Copy size={20}/>}</button><button className="icon-button" autoFocus onClick={closeViewer} aria-label="Close image"><X size={23}/></button></div></div><div className="viewer-image"><button className="viewer-nav previous" aria-label="Previous image" disabled={activeIndex <= 0} onClick={() => openImage(items[activeIndex - 1])}><ArrowLeft size={23}/></button><img key={active.id} src={media(active, "original")} alt={active.title} decoding="async"/><button className="viewer-nav next" aria-label="Next image" disabled={activeIndex < 0 || activeIndex >= items.length - 1} onClick={() => openImage(items[activeIndex + 1])}><ArrowRight size={23}/></button></div><div className="viewer-caption"><div><h2>{active.title}</h2>{active.caption && <p>{active.caption}</p>}<div className="viewer-tags">{active.tags.split(",").filter(Boolean).map(tag => <button key={tag} onClick={() => { closeViewer(); setQuery(tag.trim()); }}>{tag.trim()}</button>)}</div></div><span className="dimensions">{active.width} × {active.height}{manage && <button className="button quiet" onClick={() => { const item = active; closeViewer(); setEditError(""); tagsEdited.current = false; setEditing(item); }}><Pencil size={14}/> Edit details</button>}</span></div></>}
  </dialog>
  <dialog className="edit-dialog" ref={editRef} aria-labelledby="edit-title" onCancel={() => !saving && setEditing(null)}>
   {editing && <form key={editing.id} onSubmit={save}><div className="edit-heading"><h2 id="edit-title">Edit image</h2><button type="button" className="icon-button" aria-label="Close editor" disabled={saving} onClick={() => setEditing(null)}><X size={20}/></button></div><img className="edit-preview" src={media(editing)} alt=""/><label>Title<input name="title" maxLength={160} defaultValue={editing.title} required autoFocus/></label><label>Description<textarea name="caption" maxLength={3000} defaultValue={editing.caption} rows={3}/></label><label>Tags<input ref={tagInputRef} name="tags" maxLength={600} placeholder="Separate tags with commas" defaultValue={editing.tags} onChange={() => { tagsEdited.current = true; }}/></label><TagGenerator key={editing.id} imageId={editing.id} onTags={tags => { if (tagInputRef.current) tagInputRef.current.value = mergeTags(tagInputRef.current.value, tags); refresh(); }}/><p className="fine-print">These details are visible to everyone.</p>{editError && <p className="form-error" role="alert">{editError}</p>}<div className="edit-actions"><button className="button danger" type="button" disabled={saving} onClick={remove}><Trash2 size={16}/> Delete</button><button className="button primary" type="submit" disabled={saving}>{saving && <LoaderCircle size={16} className="spin"/>} Save changes</button></div></form>}
  </dialog>
 </>;
}
