import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Reader, diagnosticReplay, LIMIT } from './store.mjs';
const root=await mkdtemp(join(tmpdir(),'fleet-integrated-'));const samples=[];
const text = r => r.messages.filter(m=>m.role==='assistant').flatMap(m=>m.content).filter(b=>b?.type==='text').map(b=>b.text).join('');
try {
 for(const mode of ['sdk','rpc'])for(const checkpoint of ['complete','ack-gap','queued','final','large-text','large-tool']){
  const dir=join(root,`${mode}-${checkpoint}`);await mkdir(dir);
  const child=fork(fileURLToPath(new URL('./case.mjs',import.meta.url)),[mode,dir,checkpoint],{detached:true,env:{PATH:process.env.PATH,HOME:dir,LANG:'C.UTF-8',PI_OFFLINE:'1'},stdio:['ignore','ignore','pipe','ipc']});
  let info,stderr='';child.on('message',m=>{info=m;});child.stderr.on('data',d=>{stderr+=d;});
  const timer=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}},40000);
  try {
   const exit=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',(code,signal)=>resolve({code,signal}));});
   assert.ok(info,JSON.stringify({exit,stderr,mode,checkpoint})); assert.equal(exit.signal,['complete','large-text','large-tool'].includes(checkpoint)?null:'SIGKILL',stderr); if(['complete','large-text','large-tool'].includes(checkpoint))assert.equal(exit.code,0,stderr);
   if(checkpoint.startsWith('large-'))assert.match(info.refused,/REFUSED/);else assert.equal(info.refused,undefined); const storage=join(dir,'store');
   const reader=await new Reader(storage,'parent-1').open();
   assert.ok(reader.stats.bytes<=LIMIT.windowBytes+LIMIT.head*2+256*1024);assert.ok(reader.entries.length<=8);
   const ordinals=reader.entries.map(e=>e.ordinal);assert.equal(new Set(ordinals).size,ordinals.length);assert.deepEqual([...ordinals].sort((a,b)=>a-b),ordinals);
   assert.ok((await new Reader(storage,'foreign').open()).filtered);
   const replay=await diagnosticReplay(storage,'parent-1'); const recovered=text(replay);
   assert.ok(recovered.length>=info.ackChars,'acknowledged text lost');assert.ok(recovered.length<=info.receivedChars,'duplicate/invented text');
   assert.ok(replay.verifiedRecords >= info.metrics.written, 'acknowledged raw record lost');
   const acknowledgedRaw=(await readFile(join(storage,'raw.capture'))).subarray(0,info.ackOffset).toString('utf8').trimEnd().split('\n');
   assert.equal(JSON.parse(acknowledgedRaw.at(-1)).hash,info.ackDigest, 'acknowledged raw byte boundary changed');
   assert.equal(replay.executable,false);assert.equal(replay.identity.group,'launch-1');assert.equal(info.metrics.synced,0);
   if(['complete','final'].includes(checkpoint))assert.equal(recovered,'audit transcript\n'.repeat(4096));
   if(checkpoint==='complete'){
    assert.ok(reader.entries.some(e=>e.message?.role==='toolResult'));
    assert.ok(reader.entries.some(e=>e.message?.content?.some?.(b=>b.type==='thinking')));
    assert.ok(reader.warnings.some(w=>w.includes('unsupported partial')));
   }else assert.ok(reader.warnings.length,'interrupted record hidden');
   if(checkpoint==='ack-gap')assert.ok(reader.warnings.some(w=>w.includes('high-water')));
   const damage=[];
   for(const target of ['head.json',`m-${Math.max(0,reader.head.count-1)}.json`]){
    const path=join(storage,target);let original;try{original=await readFile(path);}catch{continue;}
    await writeFile(path,'corrupt');const r=await new Reader(storage,'parent-1').open();assert.ok(r.warnings.some(w=>w.includes('INCOMPLETE')));damage.push({target,warnings:r.warnings,bytes:r.stats.bytes});await writeFile(path,original);
   }
   const raw=join(storage,'raw.capture');
   const rawBefore=await readFile(raw);const damaged=Buffer.from(rawBefore);damaged[Math.max(0,damaged.length-10)] ^= 1;await writeFile(raw,damaged);
   const corruptTail=await new Reader(storage,'parent-1').open();
   assert.ok(corruptTail.warnings.some(w=>w.includes('raw tail')||w.includes('high-water')));
   await writeFile(raw,rawBefore);await writeFile(raw,'{"torn":', {flag:'a'});
   const torn=await new Reader(storage,'parent-1').open();assert.ok(torn.warnings.some(w=>w.includes('high-water')));
   const tornScan=await diagnosticReplay(storage,'parent-1');assert.ok(tornScan.warnings.includes('truncated tail'));
   samples.push({ ...info,timing:undefined,exit,open:{ms:reader.openMs,...reader.stats,entries:reader.entries.length,warnings:reader.warnings},scan:{ms:replay.totalMs,bytes:replay.bytes,records:replay.verifiedRecords,warnings:replay.warnings},recoveredChars:recovered.length,lostChars:info.receivedChars-recovered.length,damage });
  }finally{clearTimeout(timer);try{process.kill(-child.pid,'SIGKILL');}catch{}}
 }
 console.log(JSON.stringify({assertions:'passed real SDK/RPC capture -> bounded reopen, tools/thinking finals, explicit unsupported partials, SIGKILL ack/head gap, queued stream, final/terminal gap, corruption, torn tail, identity/filtering',limits:LIMIT,samples},null,2));
}finally{await rm(root,{recursive:true,force:true});}
