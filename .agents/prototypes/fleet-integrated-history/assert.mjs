import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, unlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { Store, Reader, diagnosticReplay, LIMIT } from './store.mjs';
const root=await mkdtemp(join(tmpdir(),'fleet-integrated-assert-'));const samples=[];
const id={parent:'parent-1',child:'child-0',group:'launch-1'};
const final=text=>({type:'message_end',message:{role:'assistant',content:[{type:'text',text}]}});
try {
 for(const count of [0,2000,10000]){
  const dir=join(root,String(count));const start=performance.now();const s=await Store.create(dir,id);
  for(let i=0;i<count;i++)await s.append(final(`literal message ${i}`));
  await s.close();const buildMs=performance.now()-start;
  const r=await new Reader(dir,'parent-1').open();assert.equal(r.entries.length,Math.min(count,8));assert.ok(r.stats.reads<=11);assert.ok(r.stats.bytes<=LIMIT.windowBytes+2*LIMIT.head+256*1024);
  const normalOpen={ms:r.openMs,...r.stats};
  if(count){assert.equal(r.entries.at(-1).message.content[0].text,`literal message ${count-1}`);await r.move(-1);const detached=JSON.stringify(r.entries);await r.refresh();assert.equal(JSON.stringify(r.entries),detached);const anchor=r.entries[0].ordinal;r.toggle();assert.equal(r.entries[0].ordinal,anchor);}
  const replay=await diagnosticReplay(dir,'parent-1');assert.equal(replay.messages.length,count);
  if(count) {
   const all=new Set();const pages=await new Reader(dir,'parent-1').open();
   for(;;){for(const e of pages.entries)all.add(e.ordinal);if(pages.entries[0].ordinal===0)break;await pages.move(-8);}
   assert.equal(all.size,count);for(let n=0;n<count;n++)assert.ok(all.has(n));
  }
  const head=await readFile(join(dir,'head.json'));await unlink(join(dir,'head.json'));const missing=await new Reader(dir,'parent-1').open();assert.equal(missing.entries.length,Math.min(count,8));assert.ok(missing.warnings.some(w=>w.includes('validated earliest raw prefix')));await writeFile(join(dir,'head.json'),head);
  const before=(await stat(join(dir,'raw.capture'))).size;
  const conflict=spawnSync(process.execPath,['--input-type=module','-e',`import {Store} from ${JSON.stringify(new URL('./store.mjs',import.meta.url).href)};await Store.create(${JSON.stringify(dir)},${JSON.stringify(id)});`],{encoding:'utf8'});
  assert.notEqual(conflict.status,0);assert.ok(conflict.stderr.includes('EEXIST'));assert.equal((await stat(join(dir,'raw.capture'))).size,before);
  samples.push({count,buildMs,normalOpen,fullScan:{ms:replay.totalMs,bytes:replay.bytes},concurrentWriter:'cross-process EEXIST, raw unchanged',missingHead:{warnings:missing.warnings,prefixRecoveryMs:missing.prefixRecoveryMs,bytes:missing.stats.bytes,entries:missing.entries.length}});
 }
 const selected=await Store.create(join(root,'selected'),id);await selected.append(final('selected literal'));
 const foreign=await Store.create(join(root,'unselected'),{...id,child:'other'});
 const selectedReader=await new Reader(selected.root,id.parent).open();const selectedBefore=JSON.stringify(selectedReader.entries);
 for(let n=0;n<16;n++)await foreign.append(final('foreign stream'));
 await selectedReader.refresh();assert.equal(JSON.stringify(selectedReader.entries),selectedBefore);
 await selected.close();await foreign.close();
 const s=await Store.create(join(root,'limits'),id);
 await s.append({type:'message_start',message:{role:'assistant',content:[]}});
 for(let i=0;i<110;i++)await s.append({type:'message_update',assistantMessageEvent:{type:'text_delta',contentIndex:0,delta:'x'.repeat(1024)}});
 let r=await new Reader(s.root,id.parent).open();assert.ok(r.entries.at(-1).unsupported);assert.ok(r.residentBytes<LIMIT.message);
 for(const role of ['assistant','toolResult']){
  assert.throws(()=>s.append({type:'message_end',message:{role,content:[{type:'text',text:'z'.repeat(300000)}]}}),/REFUSED/);
 }
 r=await new Reader(s.root,id.parent).open();assert.ok(r.warnings.some(w=>w.includes('admission refused')));await s.close();
 const q=await Store.create(join(root,'queue'),id);const pending=[];
 for(let i=0;i<64;i++)pending.push(q.append({type:'probe',i}));assert.throws(()=>q.append({type:'probe'}),/REFUSED/);await Promise.all(pending);await q.close();
 assert.equal(q.stats.maxQueueEntries,64);
 const b=await Store.create(join(root,'bytequeue'),id);const jobs=[];let byteRefused=false;
 for(let i=0;i<10;i++){try{jobs.push(b.append({type:'probe',text:'y'.repeat(60000)}));}catch{byteRefused=true;break;}}
 assert.ok(byteRefused);await Promise.all(jobs);await b.close();assert.ok(b.stats.maxQueueBytes<=LIMIT.queueBytes);
 const correction=await Store.create(join(root,'correction'),id);
 await correction.append({type:'message_start',message:{role:'assistant',content:[]}});
 await correction.append({type:'message_update',assistantMessageEvent:{type:'text_delta',contentIndex:0,delta:'draft'}});
 await correction.append(final('final correction'));await correction.close();
 const corrected=await new Reader(correction.root,id.parent).open();assert.equal(corrected.entries.length,1);assert.equal(corrected.entries[0].message.content[0].text,'final correction');
 console.log(JSON.stringify({assertions:'passed bounded large-history open, measured build and full scan, missing head, cross-process one-writer refusal, cumulative overlarge display refusal, oversized text/tool raw-event refusal, explicit queue entry AND byte refusal, final replacement',limits:LIMIT,samples,queues:[q.stats,b.stats],oversize:{rawBytes:(await stat(join(s.root,'raw.capture'))).size,display:r.entries,warnings:r.warnings}},null,2));
}finally{await rm(root,{recursive:true,force:true});}
