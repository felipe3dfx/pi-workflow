import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { Capture, normalize } from "./capture.mjs";
const [mode,root,checkpoint]=process.argv.slice(2);
process.env.PI_CODING_AGENT_DIR=join(root,"agent");process.env.PI_OFFLINE="1";
await mkdir(process.env.PI_CODING_AGENT_DIR,{recursive:true});
const {createAgentSession,DefaultResourceLoader,ModelRuntime,RpcClient,SessionManager,SettingsManager}=await import("@earendil-works/pi-coding-agent");
const {fauxProvider}=await import("@earendil-works/pi-ai");
const capture=await Capture.create(join(root,"child.capture"),{parent:"parent-1",child:"child-0",group:"launch-1",role:"worker",task:"capture fixture",launchOrdinal:0});
const extension=fileURLToPath(new URL("../fleet-history-comparison/provider.mjs",import.meta.url));
let handle;
if(mode==="sdk"){
 const runtime=await ModelRuntime.create({authPath:join(root,"agent","auth.json"),modelsPath:null,refreshOnCreate:false});
 const settings=SettingsManager.inMemory({compaction:{enabled:false},retry:{enabled:false}},{projectTrusted:false});
 const loader=new DefaultResourceLoader({cwd:root,agentDir:process.env.PI_CODING_AGENT_DIR,settingsManager:settings,noExtensions:true,additionalExtensionPaths:[extension],noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true});await loader.reload();
 const model=fauxProvider({provider:"fleet-fixture",models:[{id:"local",contextWindow:10000000,maxTokens:100000}]}).getModel();
 const {session}=await createAgentSession({cwd:root,agentDir:process.env.PI_CODING_AGENT_DIR,modelRuntime:runtime,model,settingsManager:settings,resourceLoader:loader,sessionManager:SessionManager.inMemory(),noTools:true});await session.bindExtensions({});
 handle={subscribe:f=>session.subscribe(f),prompt:()=>session.prompt("fixture run"),stop:()=>session.dispose()};
}else{
 const cli=fileURLToPath(new URL("./cli.js",import.meta.resolve("@earendil-works/pi-coding-agent")));
 const client=new RpcClient({cliPath:cli,cwd:root,provider:"fleet-fixture",model:"local",args:["--offline","--no-session","--no-extensions","--extension",extension,"--no-skills","--no-prompt-templates","--no-context-files","--no-themes","--no-mcp","--no-tools"]});await client.start();await client.getState();await client.setAutoCompaction(false);await client.setAutoRetry(false);
 handle={subscribe:f=>client.onEvent(f),prompt:()=>client.promptAndWait("fixture run",undefined,20000),stop:()=>client.stop()};
}
const lag=monitorEventLoopDelay({resolution:1});lag.enable();
const lagStats=()=>({hostLagP99Ms:lag.percentile(99)/1e6,hostLagMaxMs:lag.max/1e6});
let receivedText="";let ackText="";let deltas=0;let fired=false;const acknowledgments=[];
function kill(){if(fired)return;fired=true;process.send({checkpoint,mode,receivedText,ackText,metrics:capture.metrics,lag:lagStats(),acknowledgments},()=>process.kill(process.pid,"SIGKILL"));}
handle.subscribe(event=>{
 const e=normalize(event);if(!e)return;
 const isDelta=e.type==="message_update"&&e.assistantMessageEvent.type==="text_delta";
 if(isDelta){deltas++;receivedText+=e.assistantMessageEvent.delta;}
 const promise=capture.append(e);
 void promise.then(ack=>{
  if(isDelta)ackText+=e.assistantMessageEvent.delta;
  if(e.type==="message_end"&&e.message.role==="assistant")ackText=e.message.content.filter(b=>b.type==="text").map(b=>b.text).join("");
  acknowledgments.push(ack.seq);
  if(checkpoint==="ack"&&deltas>=8)kill();
  if(checkpoint==="final"&&e.type==="agent_settled")kill();
 }).catch(error=>{console.error(error);process.exit(1);});
 if(checkpoint==="queued"&&isDelta&&deltas===8)kill();
});
try{
 await handle.prompt();
 await capture.chain;
 if(checkpoint==="complete"){
  await capture.append({type:"state",state:"completed"});await capture.close();
  await new Promise((resolve,reject)=>process.send({checkpoint,mode,receivedText,ackText,metrics:capture.metrics,lag:lagStats(),acknowledgments},error=>error?reject(error):resolve()));
 }else await new Promise(()=>{});
}finally{await handle.stop();}
if(process.connected)process.disconnect();
