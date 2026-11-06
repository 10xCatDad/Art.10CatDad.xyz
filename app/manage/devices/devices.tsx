"use client";
import { useCallback, useEffect, useState } from "react";
import type { ArtDevice } from "@/lib/device-auth";
export default function Devices() {
 const [devices, setDevices] = useState<ArtDevice[]>([]), [name, setName] = useState("Android phone");
 const [token, setToken] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false), [copied, setCopied] = useState(false);
 const [ready, setReady] = useState(false);
 const refresh = useCallback(async () => {
  const response = await fetch("/api/companion/devices");
  if (!response.ok) throw new Error("Could not load devices. Refresh and sign in again.");
  setDevices(((await response.json()) as { devices: ArtDevice[] }).devices);
 }, []);
 useEffect(() => { setReady(true); refresh().catch(e => setError(e.message)); }, [refresh]);
 async function create() {
  setBusy(true); setError(""); setToken(""); setCopied(false);
  try {
   const response = await fetch("/api/companion/devices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
   const result = await response.json() as { token: string; error?: string }; if (!response.ok) throw new Error(result.error);
   setToken(result.token); await refresh();
  } catch (e) { setError(e instanceof Error ? e.message : "Could not create key."); } finally { setBusy(false); }
 }
 async function revoke(device: ArtDevice) {
  if (!confirm(`Disconnect ${device.name}? It will need a new key to manage media.`)) return;
  setBusy(true); setError("");
  try {
   const response = await fetch(`/api/companion/devices/${device.id}`, { method: "DELETE" });
   if (!response.ok) throw new Error("Could not disconnect device.");
   setToken(""); await refresh();
  } catch (e) { setError(e instanceof Error ? e.message : "Try again."); } finally { setBusy(false); }
 }
 return <main className="main devices-page">
  <a href="/manage" className="button small">Back to manage</a>
  <h1>Devices</h1><p className="intro">Connect the Android companion to manage your gallery.</p>
  <section className="device-panel">
   <h2>Connect a device</h2><p>Create a key here, then paste it into the app. Keys allow uploads, edits, and deletion for 90 days.</p>
   <label>Device name<input value={name} maxLength={60} disabled={!ready} onChange={e => setName(e.target.value)} /></label>
   <button className="button primary" disabled={!ready || busy || !name.trim() || !!token} onClick={create}>CREATE KEY</button>
   {token && <div className="device-key"><label>Device key<input type="password" value={token} readOnly autoComplete="off" spellCheck={false} onFocus={e => e.target.select()} /></label>
    <p>This key is shown only here. Keep it private.</p>
    <button className="button" onClick={async () => { try { await navigator.clipboard.writeText(token); setCopied(true); } catch { setError("Select and copy the key manually."); } }}>{copied ? "COPIED" : "COPY KEY"}</button>
    <button className="button quiet" onClick={() => setToken("")}>DONE</button>
   </div>}
  </section>
  {error && <p role="alert" className="form-error">{error}</p>}
  <section className="device-panel"><h2>Connected devices</h2>
   {devices.length === 0 && <p>No devices connected.</p>}
   {devices.map(device => <div className="device-row" key={device.id}><div><strong>{device.name}</strong><p>Expires {new Date(device.expires_at).toLocaleDateString()}{device.last_used_at ? ` // Used ${new Date(device.last_used_at).toLocaleDateString()}` : " // Not used yet"}</p></div><button className="button danger" disabled={busy} onClick={() => revoke(device)}>DISCONNECT</button></div>)}
  </section>
 </main>;
}
