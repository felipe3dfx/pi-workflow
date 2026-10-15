import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Capture, recover, discover } from "./capture.mjs";
const root=await mkdtemp(join(tmpdir(),"fleet-capture-"));
const samples=[];
const text=r=>r.messages.filter(m=>m.role==="assistant").flatMap(m=>m.content).filter(b=>b?.type==="text").map(b=>b.text).join("");
try{
 for(let repeat=0;repeat<2;repeat++)for(const mode of ["sdk","rpc"])for(const checkpoint of ["queued","ack","final","complete"]){
  const dir=join(root,`${repeat}-${mode}-${checkpoint}`);await mkdir(dir);
  const child=fork(fileURLToPath(new URL("./capture-case.mjs",import.meta.url)),[mode,dir,checkpoint],{detached:true,env:{PATH:process.env.PATH,HOME:dir,LANG:"C.UTF-8",PI_OFFLINE:"1"},stdio:["ignore","ignore","pipe","ipc"]});
  let info;let stderr="";child.on("message",m=>{info=m;});child.stderr.on("data",d=>{stderr+=d;});
  const timer=setTimeout(()=>{try{process.kill(-child.pid,"SIGKILL");}catch{}},30000);
  try{
   const exit=await new Promise((resolve,reject)=>{child.once("error",reject);child.once("exit",(code,signal)=>resolve({code,signal}));});
   assert.ok(info,JSON.stringify({mode,checkpoint,exit,stderr}));assert.equal(exit.signal,checkpoint==="complete"?null:"SIGKILL",stderr);if(checkpoint==="complete")assert.equal(exit.code,0,stderr);
   const path=join(dir,"child.capture");const r=await recover(path,"parent-1");const recovered=text(r);
   assert.ok(recovered.startsWith(info.ackText),"acknowledged text was lost");
   assert.ok(info.receivedText.startsWith(recovered),"recovered text was invented or duplicated");
   assert.equal(r.identity.group,"launch-1");assert.equal(r.identity.child,"child-0");assert.equal(await recover(path,"other-parent"),undefined);
   assert.equal(r.executable,false);assert.equal(r.readOnly,true);
   assert.equal(r.state,checkpoint==="complete"?"completed":"interrupted/incomplete");
   if(["final","complete"].includes(checkpoint))assert.equal(recovered,"audit transcript\n".repeat(4096));
   assert.equal(info.metrics.synced,0);
   const raw=await readFile(path,"utf8"); const lines=raw.trimEnd().split("\n");const damage=[];
   for(const kind of ["truncated","missing","corrupt","missing-tail"]){
    let bad;if(kind==="missing-tail")bad=`${lines.slice(0,-1).join("\n")}\n`;if(kind==="truncated")bad=`${raw}{"payload":"unfinished`;
    if(kind==="missing")bad=`${lines.filter((_l,i)=>i!==Math.floor(lines.length/2)).join("\n")}\n`;
    if(kind==="corrupt"){const copy=[...lines];copy[Math.floor(copy.length/2)]="invalid json";bad=`${copy.join("\n")}\n`;}
    const damaged=join(dir,`${kind}.fixture`);await writeFile(damaged,bad);const d=await recover(damaged,"parent-1");if(kind!=="missing-tail")assert.ok(d.warnings.length);assert.notEqual(d.state,"completed");assert.ok(recovered.startsWith(text(d)));damage.push({kind,verifiedRecords:d.verifiedRecords,warnings:d.warnings});
   }
   const discovered=await discover(dir,"parent-1");assert.equal(discovered.length,1);assert.equal((await discover(dir,"other-parent")).length,0);
   samples.push({repeat,mode,checkpoint,exit,receivedChars:info.receivedText.length,ackChars:info.ackText.length,recoveredChars:recovered.length,unacknowledgedChars:info.receivedText.length-info.ackText.length,observedLostChars:info.receivedText.length-recovered.length,metrics:info.metrics,lag:info.lag,recovery:{state:r.state,verifiedRecords:r.verifiedRecords,recoverMs:r.recoverMs,bytes:r.bytes,warnings:r.warnings},damage});
  }finally{clearTimeout(timer);try{process.kill(-child.pid,"SIGKILL");}catch{}}
 }
 const literal=join(root,"literal.capture");const c=await Capture.create(literal,{parent:"parent-1",child:"literal",group:"launch-2"});
 await c.append({type:"message_start",message:{role:"assistant",content:[]}});
 await c.append({type:"message_update",assistantMessageEvent:{type:"text_delta",contentIndex:0,delta:"draft"}});
 await c.append({type:"message_end",message:{role:"assistant",content:[{type:"text",text:"final correction"}]}});await c.close();assert.equal(text(await recover(literal,"parent-1")),"final correction");
 const sibling=await Capture.create(join(root,"sibling.capture"),{parent:"parent-1",child:"sibling",group:"launch-2"});await sibling.close();
 const foreign=await Capture.create(join(root,"foreign.capture"),{parent:"parent-2",child:"foreign",group:"launch-foreign"});await foreign.close();
 const grouped=await discover(root,"parent-1");assert.deepEqual(grouped.map(r=>r.identity.child).sort(),["literal","sibling"]);assert.ok(grouped.every(r=>r.identity.group==="launch-2"));assert.ok(grouped.every(r=>r.state==="interrupted/incomplete"));
 const missing=await recover(join(root,"absent.capture"),"parent-1");assert.equal(missing.state,"incomplete");
 console.log(JSON.stringify({assertions:"passed: real SDK/RPC observed text events, identity, filtering, SIGKILL checkpoints, acknowledged prefix, final reconciliation, damage, read-only replay",acknowledgment:"completed async OS write only; synced=0; no fsync/power-loss guarantee",samples},null,2));
}finally{await rm(root,{recursive:true,force:true});}
