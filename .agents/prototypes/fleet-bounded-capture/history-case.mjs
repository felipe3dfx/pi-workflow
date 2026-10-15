import { appendFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { KeybindingsManager, TUI_KEYBINDINGS, ProcessTerminal, TuiMainScreen, Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { createChildrenViews } from "../../../extensions/children-view.ts";
import { replaceSelection } from "../../../extensions/shell.ts";
import { History, build } from "./history.mjs";
const [mode, root, size] = process.argv.slice(2);
process.env.PI_CODING_AGENT_DIR = join(root,"agent"); process.env.PI_OFFLINE="1";
initTheme("dark",false);
const storage = join(root,"pages"); const built = await build(storage,Number(size));
const log = e => appendFileSync(join(root,"timing.jsonl"),`${JSON.stringify({...e,ns:String(process.hrtime.bigint())})}\n`);
const terminal = new ProcessTerminal(); const tui = new TuiMainScreen(terminal);
let history; let baseline; let views; const thread = {entries:[]}; let open = false; let seq=0; let readySeq=0;
const io=[];
if (mode === "baseline") {
 replaceSelection({schemaVersion:1,capabilities:{"child-session":true},expectations:{}});
 const child={id:"child-0",role:"worker",task:"Audit fixture",worktree:"/fixture",model:"fixture/local",thinking:"off",state:"running",createdAt:Date.now(),startedAt:Date.now()};
 let factory;
 views=createChildrenViews({list:()=>[child],get:()=>child,thread:()=>thread,subscribe:()=>()=>{},follow:()=>()=>{},changedFiles:()=>[]},{text:()=>undefined},()=>()=>{});
 void views.open({ui:{custom(make){factory=make; return new Promise(()=>{});}}});
 const theme={fg:(_c,t)=>t,bg:(_c,t)=>t,bold:t=>t};
 baseline=factory(tui,theme,new KeybindingsManager({...TUI_KEYBINDINGS,"app.thinking.toggle":{defaultKeys:"ctrl+t",description:"Thinking"}}),()=>{});
}
const write=terminal.write.bind(terminal); terminal.write=data=>{write(data); for(const m of data.matchAll(/FLEET_PROBE_(\d+)_END/g)) log({type:"write",seq:Number(m[1])});};
const component={
 render(width){const start=performance.now(); let lines;
  if(mode==="baseline") lines=baseline.render(width);
  else if(!open) lines=["History fixture · Enter to open"];
  else { const shown=history.viewport(width,35); lines=[`page ${history.page} · ${history.follow ? "follow" : "detached"}`, ...shown]; }
  lines[0]=`FLEET_PROBE_${readySeq}_END`;
  log({type:"render",seq:readySeq,ms:performance.now()-start,stats:history?.stats});
  return lines.map(l=>truncateToWidth(l,width));
 }, invalidate(){baseline?.invalidate();},
 handleInput(data){
  if(data==="q"){clearInterval(stream); views?.close(); tui.stop(); writeFileSync(join(root,"result.json"),JSON.stringify({mode,history:Number(size),built,io,stats:history?.stats,streamCounts:counts})); process.exit(0);}
  const current=++seq; log({type:"input",seq:current,data});
  void (async()=>{
   if(matchesKey(data,Key.enter)&&!open){
    const start=performance.now();
    if(mode==="candidate"){history=new History(storage); await history.open(); io.push({operation:"boundedOpenReadVerifyParse",ms:performance.now()-start,...history.stats});}
    else {
     const head=JSON.parse(await readFile(join(storage,"head.json"),"utf8")); let bytes=0; const entries=[];
     for(let p=0;p<Math.ceil(head.count/16);p++){const raw=await readFile(join(storage,`${p}.json`),"utf8");bytes+=Buffer.byteLength(raw);entries.push(...JSON.parse(JSON.parse(raw).payload));}
     thread.entries=entries; io.push({operation:"eagerRead",ms:performance.now()-start,bytes,messages:entries.length});
    }
    open=true;
   } else if(mode==="candidate"&&open){
    if(matchesKey(data,Key.pageUp)) await history.scroll(-1,terminal.columns,35);
    if(matchesKey(data,Key.pageDown)) await history.scroll(1,terminal.columns,35);
    if(matchesKey(data,Key.ctrl("t"))) history.toggle();
    if(data==="f") await history.end();
    if(matchesKey(data,Key.escape)) open=false;
   }
   if(mode==="baseline"){baseline.handleInput(data);if(matchesKey(data,Key.escape))open=false;}
   readySeq=current; tui.requestRender();
  })().catch(e=>{console.error(e);process.exit(1);});
 }
};
const counts=[0,0,0,0];
const stream=setInterval(()=>{
 for(let i=0;i<4;i++){counts[i]++; const text=`live child ${i} delta ${counts[i]}`;history?.receive(`child-${i}`,text); if(i===0)thread.streaming={role:"assistant",content:[{type:"text",text}],stopReason:"pending"};}
 tui.requestRender();
},25);
tui.addChild(component);tui.setFocus(component);tui.start();
process.once("SIGTERM",()=>{clearInterval(stream);views?.close();tui.stop();process.exit(143);});
