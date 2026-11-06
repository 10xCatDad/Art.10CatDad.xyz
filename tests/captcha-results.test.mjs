import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { cleanResultPng } from '../lib/result-png.ts';
import { uploadCaptchaResult, getCaptchaShare, getCaptchaImage } from '../lib/captcha-results.ts';

function crc(bytes) { let n=0xffffffff;for(const b of bytes){n^=b;for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;}return(n^0xffffffff)>>>0; }
function chunk(name,data=Buffer.alloc(0)){const out=Buffer.alloc(12+data.length);out.writeUInt32BE(data.length);out.write(name,4);data.copy(out,8);out.writeUInt32BE(crc(out.subarray(4,-4)),out.length-4);return out;}
function png(metadata=[],raw=Buffer.from([0,54,255,81,54,255,81])){const h=Buffer.alloc(13);h.writeUInt32BE(2);h.writeUInt32BE(1,4);h[8]=8;h[9]=2;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),...metadata.map(name=>chunk(name,Buffer.from('private embedded metadata'))),chunk('IDAT',deflateSync(raw)),chunk('IEND')]);}
function bucket(){const rows=new Map();let puts=0;return {rows,get puts(){return puts;},async head(key){return rows.get(key)||null;},async get(key){const row=rows.get(key);return row?{...row,body:new Blob([row.bytes]).stream()}:null;},async put(key,value,options){assert.equal(options.onlyIf.etagDoesNotMatch,'*');if(rows.has(key))return null;puts++;const row={bytes:Buffer.from(value),size:value.byteLength,httpEtag:'"fixture"',customMetadata:options.customMetadata};rows.set(key,row);return row;}};}
const id='a'.repeat(64),secret='fixture-only-result-image-secret-32-characters';
const request=(body,token=secret,extra={})=>new Request(`https://art.10xcatdad.xyz/api/captcha-results/${id}`,{method:'PUT',headers:{authorization:`Bearer ${token}`,'content-type':'image/png','x-result-state':'rejected','x-result-time':'1793970000000',...extra},body});

test('result PNG strips all metadata while preserving pixels and rejects malformed streams',async()=>{
 const plain=png(),withMetadata=png(['eXIf','tEXt','iTXt','zTXt','tIME','iCCP','caBX']);
 const cleaned=await cleanResultPng(withMetadata);assert.equal(cleaned.width,2);assert.equal(cleaned.height,1);assert.deepEqual(Buffer.from(await cleaned.image.arrayBuffer()),plain);
 const badCrc=Buffer.from(plain);badCrc[badCrc.length-1]^=1;await assert.rejects(()=>cleanResultPng(badCrc));
 await assert.rejects(()=>cleanResultPng(Buffer.concat([plain,Buffer.from('trailing metadata')])));
 await assert.rejects(()=>cleanResultPng(png([],Buffer.alloc(1_000_000))));
 await assert.rejects(()=>cleanResultPng(png([],Buffer.from([5,0,0,0,0,0,0]))));
 await assert.rejects(()=>cleanResultPng(Buffer.alloc(2*1024*1024+1)));
});

test('only the dedicated secret can create one immutable sanitized image outside the gallery',async()=>{
 const BUCKET=bucket(),env={BUCKET,RESULT_IMAGE_TOKEN:secret},body=png(['eXIf','iTXt']);
 assert.equal((await uploadCaptchaResult(request(body,''),id,env)).status,403);
 assert.equal((await uploadCaptchaResult(request(body,'tagger-token'),id,env)).status,403);
 assert.equal((await uploadCaptchaResult(request(body), '../gallery',env)).status,404);
 assert.equal((await uploadCaptchaResult(request(body,secret,{'content-length':String(3*1024*1024)}),id,env)).status,413);
 assert.equal((await uploadCaptchaResult(request(body,secret,{'content-type':'image/jpeg'}),id,env)).status,415);
 assert.equal((await uploadCaptchaResult(request(Buffer.from('not a PNG')),id,env)).status,400);
 assert.equal((await uploadCaptchaResult(request(body,secret,{'x-result-state':'<script>'}),id,env)).status,400);
 const responses=await Promise.all([uploadCaptchaResult(request(body),id,env),uploadCaptchaResult(request(body),id,env)]);
 assert.ok(responses.every(r=>r.status===200));assert.equal(BUCKET.puts,1);assert.deepEqual([...BUCKET.rows.keys()],[`results/${id}.png`]);
 assert.deepEqual(BUCKET.rows.get(`results/${id}.png`).bytes,png());
 assert.equal((await uploadCaptchaResult(request(png([],Buffer.from([0,1,2,3,4,5,6]))),id,env)).status,200);assert.equal(BUCKET.puts,1);
 assert.deepEqual(BUCKET.rows.get(`results/${id}.png`).bytes,png());
});

test('unlisted share metadata and PNG load without a login and reveal no upload secrets',async()=>{
 const env={BUCKET:bucket(),RESULT_IMAGE_TOKEN:secret};await uploadCaptchaResult(request(png()),id,env);
 const page=await getCaptchaShare(new Request(`https://art.10xcatdad.xyz/r/${id}`,{headers:{'user-agent':'Twitterbot/1.0'}}),id,env),html=await page.text();
 assert.equal(page.status,200);assert.match(html,/<meta name="twitter:card" content="summary_large_image">/);
 assert.match(html,new RegExp(`<meta property="og:image" content="https://art.10xcatdad.xyz/r/${id}/image.png">`));
 assert.match(html,/anyone with this link/);assert.match(html,/Level 1 \/\/ FAIL/);assert.ok(!html.includes(secret));
 assert.equal(page.headers.get('referrer-policy'),'no-referrer');assert.match(page.headers.get('x-robots-tag'),/noindex/);
 const image=await getCaptchaImage(new Request(`https://art.10xcatdad.xyz/r/${id}/image.png`),id,env);assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await image.arrayBuffer()),png());
 assert.equal((await getCaptchaShare(new Request('https://art.10xcatdad.xyz/r/unknown'),'b'.repeat(64),env)).status,404);
});
