// Private outbound-only worker. Image content never reaches tools or agent RPCs.
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { parseTags, TAG_INSTRUCTIONS, TAG_SCHEMA } from '../lib/tags.ts';
import { isImageId, sniffImage } from '../lib/images.ts';

export async function boundedBytes(response, maxBytes) {
 if (!response.body || Number(response.headers.get('content-length')) > maxBytes) throw new Error('Response too large');
 const reader = response.body.getReader(), chunks = []; let size = 0;
 try {
  while (true) {
   const { value, done } = await reader.read(); if (done) break;
   size += value.byteLength; if (size > maxBytes) throw new Error('Response too large'); chunks.push(value);
  }
 } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
 return Buffer.concat(chunks);
}
export async function readModelTags(response) {
 if (!response.ok || !response.body) throw new Error('Codex request failed');
 const reader = response.body.getReader(), decoder = new TextDecoder();
 let buffer = '', size = 0, output = '', completed = false;
 const consume = line => {
  if (!line.startsWith('data: ') || line === 'data: [DONE]') return;
  const event = JSON.parse(line.slice(6));
  if (['error', 'response.failed', 'response.incomplete'].includes(event.type)) throw new Error('Codex did not complete');
  if (/function_call|tool_call/.test(event.type || '') || (event.item?.type && !['message', 'reasoning'].includes(event.item.type)) || event.response?.output?.some(item => !['message', 'reasoning'].includes(item.type))) throw new Error('Tools are not permitted');
  if (event.type === 'response.output_text.delta') {
   if (typeof event.delta !== 'string') throw new Error('Invalid model output');
   output += event.delta; if (output.length > 3000) throw new Error('Invalid model output');
  }
  if (event.type === 'response.completed') completed = true;
 };
 try {
  while (true) {
   const { value, done } = await reader.read(); if (done) break;
   size += value.byteLength; if (size > 300_000) throw new Error('Model response too large');
   buffer += decoder.decode(value, { stream: true });
   let newline; while ((newline = buffer.indexOf('\n')) >= 0) { consume(buffer.slice(0, newline).trim()); buffer = buffer.slice(newline + 1); }
  }
  buffer += decoder.decode(); if (buffer.trim()) consume(buffer.trim());
 } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
 if (!completed) throw new Error('Incomplete model response');
 return parseTags(JSON.parse(output));
}

export class SubscriptionTagger {
 child; nextId = 1; pending = new Map();
 constructor({ spawnProcess = spawn, fetcher = fetch } = {}) {
  const env = Object.fromEntries(['HOME', 'PATH', 'CODEX_HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'SYSTEMROOT'].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
  this.fetcher = fetcher;
  this.child = spawnProcess(process.env.CODEX_BINARY || 'codex', ['app-server', '--listen', 'stdio://', '-c', 'cli_auth_credentials_store="file"'], { stdio: ['pipe', 'pipe', 'ignore'], shell: false, env });
  createInterface({ input: this.child.stdout }).on('line', line => {
   try {
    const message = JSON.parse(line), waiter = this.pending.get(message.id); if (!waiter) return;
    this.pending.delete(message.id); clearTimeout(waiter.timer);
    if (message.error) waiter.reject(new Error('Codex authentication unavailable')); else waiter.resolve(message.result);
   } catch { /* Ignore native notifications. */ }
  });
  this.child.on('error', () => this.fail()); this.child.on('exit', () => this.fail());
  this.initialized = this.rpc('initialize', { clientInfo: { name: 'art_image_tagger', version: '1.0.0' } }).then(() => this.child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n'));
 }
 fail() { for (const waiter of this.pending.values()) { clearTimeout(waiter.timer); waiter.reject(new Error('Codex authentication unavailable')); } this.pending.clear(); }
 rpc(method, params) {
  if (!['initialize', 'account/read'].includes(method)) return Promise.reject(new Error('Only authentication RPCs are allowed'));
  const id = this.nextId++;
  return new Promise((resolve, reject) => {
   const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Codex authentication timed out')); }, 20_000);
   this.pending.set(id, { resolve, reject, timer }); this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
 }
 async credentials(force = false) {
  await this.initialized;
  const { account } = await this.rpc('account/read', { refreshToken: force });
  if (account?.type !== 'chatgpt') throw new Error('Existing Codex sign-in required');
  const auth = JSON.parse(await readFile(join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'auth.json'), 'utf8'));
  if (!auth.tokens?.access_token || !auth.tokens?.account_id) throw new Error('Codex sign-in unavailable');
  const expiry = JSON.parse(Buffer.from(auth.tokens.access_token.split('.')[1], 'base64url')).exp;
  if (!force && expiry * 1000 < Date.now() + 120_000) return this.credentials(true);
  return auth.tokens;
 }
 async evaluate(image) {
  if (!(image instanceof Uint8Array) || image.length < 12 || image.length > 1024 * 1024) throw new Error('Invalid thumbnail');
  const mime = sniffImage(image); if (!mime) throw new Error('Invalid thumbnail');
  const imageUrl = `data:${mime};base64,${Buffer.from(image).toString('base64')}`;
  const deadline = AbortSignal.timeout(100_000); let response;
  for (let attempt = 0; attempt < 2; attempt++) {
   const auth = await this.credentials(attempt === 1);
   response = await this.fetcher('https://chatgpt.com/backend-api/codex/responses', {
    method: 'POST', redirect: 'error', signal: deadline,
    headers: { authorization: `Bearer ${auth.access_token}`, 'ChatGPT-Account-Id': auth.account_id, 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({ model: process.env.ART_TAGGER_MODEL || 'gpt-6-luna', instructions: TAG_INSTRUCTIONS,
     input: [{ role: 'user', content: [{ type: 'input_text', text: 'Suggest search tags for this image.' }, { type: 'input_image', image_url: imageUrl, detail: 'auto' }] }],
     tools: [], tool_choice: 'none', store: false, stream: true, reasoning: { effort: 'low' },
     text: { format: { type: 'json_schema', name: 'image_tags', strict: true, schema: TAG_SCHEMA } } }),
   });
   if (response.status !== 401) break;
   await response.body?.cancel();
  }
  return readModelTags(response);
 }
 dispose() { this.child.kill(); this.fail(); }
}

async function main() {
 const origin = process.env.ART_SITE_ORIGIN || 'https://art.10xcatdad.xyz';
 const url = new URL(origin);
 if (url.origin !== origin || (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1'))) throw new Error('Invalid gallery origin');
 if (!process.env.TAGGER_TOKEN || process.env.TAGGER_TOKEN.length < 32) throw new Error('Worker secret missing');
 const tagger = new SubscriptionTagger();
 const call = async (action, body = {}) => {
  const response = await fetch(`${origin}/api/tagger/${action}`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { authorization: `Bearer ${process.env.TAGGER_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error('Worker endpoint unavailable');
  return JSON.parse((await boundedBytes(response, 16_384)).toString('utf8'));
 };
 await tagger.credentials(); await call('heartbeat');
 const heartbeat = setInterval(() => tagger.credentials().then(() => call('heartbeat')).catch(() => {}), 30_000);
 for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { clearInterval(heartbeat); tagger.dispose(); process.exit(0); });
 console.log('Image tagger started. Image content and account details are not logged.');
 while (true) {
  try {
   await tagger.credentials();
   const { job } = await call('next');
   if (!job) { await delay(5000); continue; }
   if (typeof job.id !== 'string' || typeof job.lease !== 'string' || !isImageId(job.id) || !isImageId(job.lease)) throw new Error('Invalid job');
   let completion = { id: job.id, lease: job.lease, error: true };
   try {
    const response = await fetch(`${origin}/media/${job.id}/thumbnail`, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error('Image unavailable');
    completion = { id: job.id, lease: job.lease, tags: await tagger.evaluate(await boundedBytes(response, 1024 * 1024)) };
   } catch { console.warn('Image tagging did not complete.'); }
   // Retry only result delivery; never repeat inference after an ambiguous response.
   for (let attempt = 0; attempt < 4; attempt++) { try { await call('complete', completion); break; } catch { await delay(2000); } }
  } catch { await delay(10_000); }
 }
}
if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) main().catch(() => { console.error('Image tagger could not start. Check the local sign-in and configuration.'); process.exit(1); });
