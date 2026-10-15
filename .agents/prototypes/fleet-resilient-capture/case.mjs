import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, Reader, normalize, fixtureIO, LIMIT } from './store.mjs';
const [mode,root,scenario]=process.argv.slice(2);
process.env.PI_CODING_AGENT_DIR=join(root,'agent');process.env.PI_OFFLINE='1';
await mkdir(process.env.PI_CODING_AGENT_DIR,{recursive:true});
const {createAgentSession,DefaultResourceLoader,ModelRuntime,RpcClient,SessionManager,SettingsManager}=await import('@earendil-works/pi-coding-agent');
const {fauxProvider}=await import('@earendil-works/pi-ai');
const io=fixtureIO(scenario==='no-storage'?'all-block':scenario);
if(scenario==='no-storage')io.armed=true;
const identity={parent:'parent-1',child:'child-0',group:'launch-1',role:'worker',task:'resilient capture fixture',launchOrdinal:0};
const capture=Store.create(join(root,'store'),identity,io);
capture.append({type:'message_end',message:{role:'user',content:'persisted prefix',timestamp:0}});
const extension=fileURLToPath(new URL('./provider.mjs',import.meta.url));
let handle;const controls={abort:0,steer:0,followUp:0};
function monitor(target){for(const key of Object.keys(controls))if(typeof target[key]==='function'){const f=target[key].bind(target);target[key]=(...args)=>{controls[key]++;return f(...args);};}}
if(mode==='sdk') {
 const runtime=await ModelRuntime.create({authPath:join(root,'agent','auth.json'),modelsPath:null,refreshOnCreate:false});
 const settings=SettingsManager.inMemory({compaction:{enabled:false},retry:{enabled:false}},{projectTrusted:false});
 const loader=new DefaultResourceLoader({cwd:root,agentDir:process.env.PI_CODING_AGENT_DIR,settingsManager:settings,noExtensions:true,additionalExtensionPaths:[extension],noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true});await loader.reload();
 const model=fauxProvider({provider:'fleet-fixture',models:[{id:'local',contextWindow:10000000,maxTokens:100000}]}).getModel();
 const {session}=await createAgentSession({cwd:root,agentDir:process.env.PI_CODING_AGENT_DIR,modelRuntime:runtime,model,settingsManager:settings,resourceLoader:loader,sessionManager:SessionManager.inMemory(),tools:['fixture_result']});await session.bindExtensions({});
 monitor(session);handle={subscribe:f=>session.subscribe(f),prompt:()=>session.prompt('fixture run'),messages:async()=>session.messages,stop:()=>session.dispose()};
}else {
 const cli=fileURLToPath(new URL('./cli.js',import.meta.resolve('@earendil-works/pi-coding-agent')));
 const client=new RpcClient({cliPath:cli,cwd:root,provider:'fleet-fixture',model:'local',args:['--offline','--no-session','--no-extensions','--extension',extension,'--no-skills','--no-prompt-templates','--no-context-files','--no-themes','--no-mcp','--tools','fixture_result']});await client.start();await client.getState();await client.setAutoCompaction(false);await client.setAutoRetry(false);
 monitor(client);handle={subscribe:f=>client.onEvent(f),prompt:()=>client.promptAndWait('fixture run',undefined,20000),messages:()=>client.getMessages(),stop:()=>client.stop()};
}
let normalized=0,settled=false;const kinds={};let firstLiveFailure,firstFailureRawWrites;
handle.subscribe(original=>{
 const e=normalize(original);if(!e)return;normalized++;kinds[e.type]=(kinds[e.type]??0)+1;
 if(e.type==='agent_settled')settled=true;
 if(e.type==='message_update' && e.assistantMessageEvent.type==='text_delta' && !io.armed && !['success','short'].includes(scenario))io.armed=true;
 capture.append(e);
 if(capture.health.state==='incomplete'&&!firstLiveFailure){firstLiveFailure=structuredClone(capture.health);firstFailureRawWrites=io.rawWrites;}
});
try {
 const start=performance.now();await handle.prompt();const runMs=performance.now()-start;
 const messages=await handle.messages();
 const assistant=messages.filter(m=>m.role==='assistant').flatMap(m=>m.content).filter(b=>b.type==='text').map(b=>b.text).join('');
 const tool=messages.filter(m=>m.role==='toolResult').flatMap(m=>m.content).filter(b=>b.type==='text').map(b=>b.text).join('');
 assert.equal(assistant,'L'.repeat(180000),'agent result changed by capture');assert.equal(tool,'T'.repeat(300000),'agent tool result changed by capture');
 const stopReason=messages.filter(m=>m.role==='assistant').at(-1).stopReason;
 assert.equal(stopReason,'stop');assert.ok(settled,'agent did not settle normally');assert.deepEqual(controls,{abort:0,steer:0,followUp:0});
 capture.append({type:'state',state:'completed'});capture.close();
 const reader=new Reader(join(root,'store'),'parent-1').open();const openStats={...reader.stats};
 assert.ok(openStats.bytes<=LIMIT.metadata*3+LIMIT.frame+4,'ordinary open unbounded');
 assert.ok(openStats.maxReadBytes<=LIMIT.frame);
 const prefix=reader.prefix();assert.ok(prefix.stats.bytes<=LIMIT.prefixFrames*(LIMIT.frame+4));
 const replay=reader.reconcile();assert.equal(replay.executable,false);assert.equal(replay.readOnly,true);
 assert.equal(replay.events,capture.health.persistedEvents,'persisted complete-event accounting mismatch');
 assert.equal(capture.health.observed,capture.health.persistedEvents+capture.health.droppedEvents,'explicit loss accounting mismatch');
 const recoveredText=replay.messages.filter(m=>m.role==='assistant').flatMap(m=>m.content??[]).filter(b=>b?.type==='text').map(b=>b.text).join('');
 const recoveredTool=replay.messages.filter(m=>m.role==='toolResult').flatMap(m=>m.content??[]).filter(b=>b?.type==='text').map(b=>b.text).join('');
 if(['success','short'].includes(scenario)) {
  assert.equal(capture.health.state,'healthy');assert.equal(capture.health.droppedEvents,0);
  assert.equal(recoveredText,'L'.repeat(180000));assert.equal(recoveredTool,'T'.repeat(300000));assert.equal(replay.completed,true);
  assert.equal(replay.messages.filter(m=>m.role==='toolResult').length,1);
  assert.equal(replay.messages.filter(m=>m.role==='assistant').length,2,'partial/final duplicated');
  assert.ok(replay.messages.some(m=>m.content?.some?.(b=>b.type==='thinking')));
  assert.deepEqual(reader.identity,identity);assert.ok(new Reader(join(root,'store'),'foreign').open().filtered);
  if(scenario==='short')assert.ok(io.shortWrites>0);
 } else {
  assert.equal(io.rawWrites,firstFailureRawWrites,'writes continued after capture was disabled');
  assert.equal(capture.health.state,'incomplete');assert.ok(firstLiveFailure?.cause);assert.ok(capture.health.droppedEvents>0);assert.ok(capture.health.droppedEncodedBytes>0);
  assert.ok(reader.warnings.some(w=>w.includes('INCOMPLETE')));assert.equal(replay.completed,false);
  if(scenario!=='no-storage'){
   assert.ok(replay.messages.some(m=>m.content==='persisted prefix'),'prefix unreadable');assert.equal(recoveredTool,'T'.repeat(300000));
   assert.ok(prefix.messages.some(m=>m.content==='persisted prefix'));
   assert.ok(new Reader(join(root,'store'),'foreign').open().filtered);
  }else {assert.equal(reader.identity,undefined);assert.equal(replay.events,0);}
  if(['reject','partial','zero','index'].includes(scenario)) {
   assert.ok(reader.failure?.cause,'durable cause missing despite writable marker seam');
   assert.equal(reader.failure.droppedEvents,capture.health.droppedEvents);
  }else {
   assert.equal(reader.failure,undefined,'no independent durable marker possible');assert.equal(capture.health.durableMarker,false);
   assert.ok(!reader.warnings.some(w=>w.includes('ENOSPC')),'live-only cause was invented on disk');
  }
  if(scenario==='partial')assert.ok(replay.warnings.some(w=>w.includes('partial chunk/frame')));
  if(scenario!=='no-storage')assert.ok(io.injected>0);
 }
 assert.equal(capture.stats.maxQueuedBytes,0);assert.equal(capture.stats.maxQueuedEntries,0);
 assert.ok(capture.stats.maxChunkBytes<=LIMIT.chunk);assert.ok(capture.stats.maxFrameBytes<=LIMIT.frame+4);
 const result={mode,scenario,normalResult:{assistantChars:assistant.length,toolChars:tool.length,stopReason,settled,controls},normalized,kinds,runMs,
  health:capture.health,firstLiveFailure,metrics:capture.stats,io:{shortWrites:io.shortWrites,injected:io.injected,rawWrites:io.rawWrites,firstFailureRawWrites},
  reopen:{ms:reader.openMs,...openStats,warnings:reader.warnings,durableFailure:reader.failure},
  prefix:{events:prefix.events,...prefix.stats,warnings:prefix.warnings},
  reconciliation:{ms:replay.ms,events:replay.events,frames:replay.frames,...replay.stats,maxEventBytes:replay.maxEventBytes,assistantChars:recoveredText.length,toolChars:recoveredTool.length,warnings:replay.warnings}};
 await writeFile(join(root,'result.json'),JSON.stringify(result));
 if(process.send)await new Promise(resolve=>process.send(result,resolve));
}finally{await handle.stop();capture.close();}
if(process.connected)process.disconnect();
