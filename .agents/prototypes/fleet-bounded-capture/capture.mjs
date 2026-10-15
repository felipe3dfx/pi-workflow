import { open, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
const hash = value => createHash("sha256").update(value).digest("hex");
// Transport-independent observed event seam. SDK cumulative snapshots are deliberately
// omitted, matching RPC's delta-only shape. Only TEXT partial reconstruction is supported.
export function normalize(event) {
 if(event.type === "message_update") {
  const e=event.assistantMessageEvent;
  if(["text_start","text_delta","text_end"].includes(e.type)) return {type:event.type,assistantMessageEvent:{type:e.type,contentIndex:e.contentIndex,...(e.delta!==undefined?{delta:e.delta}:{}),...(e.content!==undefined?{content:e.content}:{})}};
  return {type:"unsupported_partial",kind:e.type};
 }
 if(["message_start","message_end"].includes(event.type)) return {type:event.type,message:event.message};
 if(event.type.startsWith("tool_execution_") || event.type === "agent_settled") return event;
 return undefined;
}
export class Capture {
 static async create(path, identity) {
  const c = new Capture(); c.file=await open(path,"wx"); c.seq=0;c.prev="root";c.queuedBytes=0;c.chain=Promise.resolve();
  c.metrics={received:0,queued:0,written:0,synced:0,maxQueuedBytes:0,maxWriteAckMs:0};
  await c.append({type:"identity",...identity}); return c;
 }
 append(event) {
  const start=performance.now(); this.metrics.received++;
  const record={seq:++this.seq,prev:this.prev,event}; const payload=JSON.stringify(record); const digest=hash(payload);this.prev=digest;
  const bytes=Buffer.from(`${JSON.stringify({payload,hash:digest})}\n`);
  if(this.queuedBytes+bytes.length>256*1024) throw new Error("capture queue limit exceeded; capture incomplete");
  this.queuedBytes+=bytes.length;this.metrics.queued++;this.metrics.maxQueuedBytes=Math.max(this.metrics.maxQueuedBytes,this.queuedBytes);
  const written=this.chain.then(async()=>{
   let offset=0; while(offset<bytes.length){const result=await this.file.write(bytes,offset,bytes.length-offset); if(!result.bytesWritten)throw new Error("zero write");offset+=result.bytesWritten;}
   this.queuedBytes-=bytes.length;this.metrics.written++; this.metrics.maxWriteAckMs=Math.max(this.metrics.maxWriteAckMs,performance.now()-start);
   return {seq:record.seq,bytes:bytes.length};
  });
  this.chain=written; return written;
 }
 async close(){await this.chain; await this.file.close();}
}
export async function recover(path, parent) {
 const start=performance.now(); let raw;
 try {raw=await readFile(path,"utf8");}catch(e){return {state:"incomplete",warnings:[e.code],messages:[],readOnly:true};}
 const warnings=[];const events=[];let prev="root";let next=1;
 const lines=raw.split("\n");if(lines.at(-1)!=="")warnings.push("truncated tail"); lines.pop();
 for(const line of lines){
  try {const env=JSON.parse(line);if(hash(env.payload)!==env.hash)throw new Error("hash");const r=JSON.parse(env.payload);if(r.seq!==next||r.prev!==prev)throw new Error("sequence");events.push(r.event);next++;prev=env.hash;}catch{warnings.push(`corrupt/missing record ${next}; stopped at verified prefix`);break;}
 }
 const identity=events[0];if(identity?.type!=="identity")return {state:"incomplete",warnings:[...warnings,"missing identity"],messages:[],readOnly:true};
 if(identity.parent!==parent)return undefined;
 const messages=[];let current;let settled=false;let completed=false;
 for(const e of events.slice(1)){
  if(e.type==="message_start"){current=structuredClone(e.message);messages.push(current);}
  if(e.type==="message_update"){
   if(current?.role!=="assistant"){warnings.push("delta without assistant start");continue;}
   const b=e.assistantMessageEvent; current.content ??=[];
   const index=b.contentIndex; if(!Number.isInteger(index)||index<0||index>10000){warnings.push("invalid content index");continue;}
   if(b.type==="text_start")current.content[index]={type:"text",text:""};
   else if(b.type==="text_delta"){current.content[index]??={type:"text",text:""}; current.content[index].text+=b.delta;}
   else if(b.type==="text_end")current.content[index]={type:"text",text:b.content};
  }
  if(e.type==="message_end"){
   const final=structuredClone(e.message);if(current){messages[messages.length-1]=final;current=undefined;}else messages.push(final);
  }
  if(e.type==="unsupported_partial")warnings.push(`partial ${e.kind} not reconstructed`);
  if(e.type==="agent_settled")settled=true;
  if(e.type==="state"&&e.state==="completed")completed=true;
 }
 if(current)warnings.push("unfinished message");
 return {identity,state:completed&&settled&&!warnings.length?"completed":"interrupted/incomplete",warnings,messages,events,verifiedRecords:next-1,bytes:Buffer.byteLength(raw),recoverMs:performance.now()-start,readOnly:true,executable:false};
}
export async function discover(root,parent){const records=[];for(const name of await readdir(root)){if(name.endsWith(".capture")){const r=await recover(join(root,name),parent);if(r)records.push(r);}}return records;}
