import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTags, mergeTags, publicTagJob, TAG_JOB_TIMEOUT } from '../lib/tags.ts';
import { boundedBytes, readModelTags } from '../scripts/codex-tagger.mjs';
test('generated tags are bounded, normalized, and deduplicated', () => {
 assert.deepEqual(parseTags({ tags: ['Anime', 'golden   hair', 'anime'] }), ['anime', 'golden hair']);
 for (const result of [{tags:[]},{tags:['x'.repeat(41)]},{tags:Array(13).fill('cat')},{tags:['name@example.test']},{tags:['https://example.test']},{tags:['a,b']},{tags:['cat'],secret:'no'}]) assert.throws(() => parseTags(result));
});
test('suggestions preserve existing manual tags without case duplicates', () => {
 assert.equal(mergeTags('Custom, Anime', ['anime','portrait']), 'Custom, Anime, portrait');
 assert.equal(mergeTags(Array.from({length:12},(_,i)=>`tag ${i}`).join(','),['new']).split(',').length,12);
});
test('owner status never returns the worker lease and expires stalled jobs', () => {
 const job={image_id:'id',state:'running',tags:'',requested_at:100,started_at:200,lease:'private'};
 assert.equal(publicTagJob(job,100+TAG_JOB_TIMEOUT+1).state,'error');
 assert.equal('lease' in publicTagJob(job,200),false);
 assert.deepEqual(publicTagJob({...job,state:'done',tags:JSON.stringify({tags:['cat']})},300).tags,['cat']);
});
const response = events => new Response(events.map(event=>`data: ${JSON.stringify(event)}\n\n`).join(''));
test('only completed model text yields tags',async()=>{
 const text={type:'response.output_text.delta',delta:'{"tags":["cat","portrait"]}'};
 assert.deepEqual(await readModelTags(response([text,{type:'response.completed'}])),['cat','portrait']);
 await assert.rejects(readModelTags(response([text])),/Incomplete/);
 await assert.rejects(readModelTags(response([text,{type:'response.failed'}])),/complete/);
});
test('model tool calls are rejected even with a plausible tag result',async()=>{
 await assert.rejects(readModelTags(response([{type:'response.output_item.added',item:{type:'function_call',name:'exec_command'}}])),/Tools/);
 await assert.rejects(readModelTags(response([{type:'response.completed',response:{output:[{type:'function_call'}]}}])),/Tools/);
});
test('thumbnail downloads enforce the size cap without trusting headers',async()=>{
 assert.equal((await boundedBytes(new Response('small'),10)).length,5);
 await assert.rejects(boundedBytes(new Response('too much'),3),/large/);
});
