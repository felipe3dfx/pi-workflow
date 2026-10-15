import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { Store, normalize } from "./store.mjs";
import { writeFile } from "node:fs/promises";
import { startUI } from "./ui.mjs";
const [mode,root,checkpoint]=process.argv.slice(2);
if(checkpoint.startsWith('large-'))process.env.FLEET_LARGE=checkpoint;
process.env.PI_CODING_AGENT_DIR=join(root,"agent");process.env.PI_OFFLINE="1";
await mkdir(process.env.PI_CODING_AGENT_DIR,{recursive:true});
const {createAgentSession,DefaultResourceLoader,ModelRuntime,RpcClient,SessionManager,SettingsManager}=await import("@earendil-works/pi-coding-agent");
const {fauxProvider}=await import("@earendil-works/pi-ai");
const capture=await Store.create(join(root,"store"),{parent:"parent-1",child:"child-0",group:"launch-1",role:"worker",task:"capture fixture",launchOrdinal:0});
const buildStart=performance.now();
for(let i=0;i<2000;i++)await capture.append({type:'message_end',message:{role:'user',content:`retained fixture ${i}`,timestamp:i}});
const buildMs=performance.now()-buildStart;
const extension=fileURLToPath(new URL("./provider.mjs",import.meta.url));
let handle;
if(mode==="sdk"){
 const runtime=await ModelRuntime.create({authPath:join(root,"agent","auth.json"),modelsPath:null,refreshOnCreate:false});
 const settings=SettingsManager.inMemory({compaction:{enabled:false},retry:{enabled:false}},{projectTrusted:false});
 const loader=new DefaultResourceLoader({cwd:root,agentDir:process.env.PI_CODING_AGENT_DIR,settingsManager:settings,noExtensions:true,additionalExtensionPaths:[extension],noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true});await loader.reload();
 const model=fauxProvider({provider:"fleet-fixture",models:[{id:"local",contextWindow:10000000,maxTokens:100000}]}).getModel();
 const {session}=await createAgentSession({cwd:root,agentDir:process.env.PI_CODING_AGENT_DIR,modelRuntime:runtime,model,settingsManager:settings,resourceLoader:loader,sessionManager:SessionManager.inMemory(),tools:["fixture_result"]});await session.bindExtensions({});
 handle={subscribe:f=>session.subscribe(f),prompt:()=>session.prompt("fixture run"),abort:()=>session.abort(),stop:()=>session.dispose()};
}else{
 const cli=fileURLToPath(new URL("./cli.js",import.meta.resolve("@earendil-works/pi-coding-agent")));
 const client=new RpcClient({cliPath:cli,cwd:root,provider:"fleet-fixture",model:"local",args:["--offline","--no-session","--no-extensions","--extension",extension,"--no-skills","--no-prompt-templates","--no-context-files","--no-themes","--no-mcp","--tools","fixture_result"]});await client.start();await client.getState();await client.setAutoCompaction(false);await client.setAutoRetry(false);
 handle={subscribe:f=>client.onEvent(f),prompt:()=>client.promptAndWait("fixture run",undefined,20000),abort:()=>client.abort(),stop:()=>client.stop()};
}
const lag=monitorEventLoopDelay({resolution:1});lag.enable();
let ui; const timing=[]; const log=e=>timing.push({...e,ns:String(process.hrtime.bigint())});
if(checkpoint==='pty') ui=await startUI(join(root,'store'),log);
let deltas=0; let receivedText=''; let ackText=''; let refused; let killed=false; const kinds={};
function snapshot(){return {mode,checkpoint,build:{messages:2000,ms:buildMs,kind:'synthetic retained user messages through same raw/index writer; before runtime timer'},receivedChars:receivedText.length,ackChars:ackText.length,ackOffset:capture.offset,ackDigest:capture.capture.prev,metrics:capture.capture.metrics,queue:capture.stats,kinds,lagP99Ms:lag.percentile(99)/1e6};}
async function kill(){if(killed)return;killed=true;await new Promise(resolve=>process.send(snapshot(),resolve));process.kill(process.pid,'SIGKILL');}
handle.subscribe(event=>{
 if(refused)return;
 const e=normalize(event);if(!e)return;
 kinds[e.type==='message_update'?e.assistantMessageEvent.type:e.type==='unsupported_partial'?e.kind:e.type]=(kinds[e.type==='message_update'?e.assistantMessageEvent.type:e.type==='unsupported_partial'?e.kind:e.type]??0)+1;
 const delta=e.type==='message_update'&&e.assistantMessageEvent.type==='text_delta';
 if(delta){receivedText+=e.assistantMessageEvent.delta;deltas++;if(deltas===1)void writeFile(join(root,'streaming'),'yes');}
 try {
  const p=capture.append(e,async()=>{
   if(delta)ackText+=e.assistantMessageEvent.delta;
   if(checkpoint==='ack-gap'&&delta&&deltas>=8)await kill();
   if(checkpoint==='final'&&e.type==='agent_settled')await kill();
  });
  void p.then(()=>ui?.refresh()).catch(error=>{refused=error.message;});
  if(checkpoint==='queued'&&delta&&deltas===8)void kill();
 } catch(error){refused=error.message;setImmediate(()=>{void handle.abort().catch(()=>{});});}
});
try {
 const start=performance.now(); try { await handle.prompt(); } catch(error) { if(!refused)throw error; } await capture.chain;
 if(!['queued','ack-gap','final'].includes(checkpoint)){
  if(!refused)await capture.append({type:'state',state:'completed'});await capture.close();
  await new Promise(resolve=>setTimeout(resolve,100));await ui?.stop();
  const result={...snapshot(),runMs:performance.now()-start,refused,timing};
  await writeFile(join(root,'result.json'),JSON.stringify(result));
  if(process.send)await new Promise(resolve=>process.send(result,resolve));
 }else await new Promise(()=>{});
}finally{await handle.stop();}
if(process.connected)process.disconnect();
