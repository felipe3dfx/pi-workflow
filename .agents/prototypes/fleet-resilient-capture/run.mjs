import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIMIT, Reader } from './store.mjs';
const root=await mkdtemp(join(tmpdir(),'fleet-resilient-runtime-'));const samples=[];
try {
 for(const mode of ['sdk','rpc'])for(const scenario of ['success','short','reject','partial','zero','index','all-block','no-storage']) {
  const dir=join(root,`${mode}-${scenario}`);await mkdir(dir);
  const child=fork(fileURLToPath(new URL('./case.mjs',import.meta.url)),[mode,dir,scenario],{detached:true,env:{PATH:process.env.PATH,HOME:dir,LANG:'C.UTF-8',PI_OFFLINE:'1'},stdio:['ignore','ignore','pipe','ipc']});
  let result,stderr='';child.on('message',m=>{result=m;});child.stderr.on('data',d=>{stderr+=d;});
  let exited=false;
  const timer=setTimeout(()=>{if(!exited)try{process.kill(-child.pid,'SIGKILL');}catch{}},35000);
  try {
   const exit=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',(code,signal)=>{exited=true;resolve({code,signal});});});
   assert.equal(exit.code,0,JSON.stringify({mode,scenario,stderr,exit}));assert.ok(result,`${mode}/${scenario} missing result`);
   const reopened=new Reader(join(dir,'store'),'parent-1').open();const scan=reopened.reconcile();
   assert.equal(scan.events,result.health.persistedEvents);assert.equal(scan.executable,false);
   const healthy=['success','short'].includes(scenario);assert.equal(scan.completed,healthy);
   if(healthy){
    assert.equal(scan.messages.filter(m=>m.role==='assistant').flatMap(m=>m.content).filter(b=>b.type==='text').map(b=>b.text).join(''),'L'.repeat(180000));
    assert.equal(scan.messages.filter(m=>m.role==='toolResult')[0].content[0].text,'T'.repeat(300000));
   }else {
    assert.ok(reopened.warnings.some(w=>w.includes('INCOMPLETE')));
    if(scenario!=='no-storage')assert.ok(scan.messages.some(m=>m.content==='persisted prefix'));
    if(['all-block','no-storage'].includes(scenario))assert.equal(reopened.failure,undefined);
    else assert.equal(reopened.failure.droppedEvents,result.health.droppedEvents);
   }
   samples.push({...result,exit,afterWriterExit:{warnings:reopened.warnings,identityPresent:!!reopened.identity,durableFailure:reopened.failure,events:scan.events,completed:scan.completed,readOnly:scan.readOnly,executable:scan.executable}});
  }finally{
   clearTimeout(timer);
   try{process.kill(-child.pid,'SIGKILL');}catch{}
  }
 }
 console.log(JSON.stringify({assertions:'passed SDK/RPC normal result despite actual fixture filesystem failures; exact large text/tool on healthy and short-write runs; bounded access, readable prefix, durable vs live-only warnings, explicit loss, zero capture lifecycle controls',limits:LIMIT,samples},null,2));
}finally{await rm(root,{recursive:true,force:true});}
