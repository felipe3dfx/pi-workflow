import { openSync, closeSync, writeSync, readSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
export { normalize } from '../fleet-bounded-capture/capture.mjs';
export const LIMIT = { chunk: 16 * 1024, frame: 24 * 1024, metadata: 8192, prefixFrames: 8 };
const hash = x => createHash('sha256').update(x).digest('hex');
const envelope = v => { const payload=JSON.stringify(v); return JSON.stringify({payload,hash:hash(payload)}); };
const decode = raw => { const v=JSON.parse(raw); if(hash(v.payload)!==v.hash)throw Error('checksum'); return {value:JSON.parse(v.payload),hash:v.hash}; };
export function fixtureIO(mode='success') {
 const io={armed:false,shortWrites:0,injected:0,rawWrites:0,write(fd,buf,offset,length,position) {
  io.rawWrites++;
  if(io.armed && mode==='partial' && !io.partialWritten){io.partialWritten=true;io.shortWrites++;return writeSync(fd,buf,offset,Math.min(97,length),position);}
  if(io.armed && ['reject','all-block','zero','partial'].includes(mode)) {
   io.injected++;
   if(mode==='zero')return 0;
   throw Object.assign(Error('fixture: no space left on device'),{code:'ENOSPC'});
  }
  const n=mode==='short' && length>1 ? Math.max(1,Math.floor(length/2)) : length;
  if(n<length)io.shortWrites++;
  return writeSync(fd,buf,offset,n,position);
 },rename(from,to) {
  if(io.armed && (mode==='index' && to.endsWith('head.json') || mode==='all-block')) {
   io.injected++;throw Object.assign(Error('fixture: index publication rejected'),{code:'EIO'});
  }
  renameSync(from,to);
 },metadataWrite(fd,buf,offset,length,position) {
  if(io.armed && mode==='all-block') {io.injected++;throw Object.assign(Error('fixture: all storage unavailable'),{code:'ENOSPC'});}
  return writeSync(fd,buf,offset,length,position);
 }};
 return io;
}
function writeAll(fd,buf,write,position=0) {
 let offset=0;
 while(offset<buf.length) { const n=write(fd,buf,offset,buf.length-offset,position+offset); if(!Number.isInteger(n)||n<=0||n>buf.length-offset)throw Error('zero/invalid short write');offset+=n; }
}
function atomic(root,name,value,io) {
 const bytes=Buffer.from(envelope(value));if(bytes.length>LIMIT.metadata)throw Error('metadata bound');
 const path=join(root,`${name}.tmp`); const fd=openSync(path,'w');
 try {writeAll(fd,bytes,io.metadataWrite);}finally{closeSync(fd);}
 io.rename(path,join(root,name));
}
export class Store {
 static create(root,identity,io=fixtureIO()) {
  const s=new Store();Object.assign(s,{root,identity,io,ownsRoot:false,fd:undefined,seq:0,prev:'root',bytes:0,event:0,settled:false,completed:false,
   health:{state:'healthy',observed:0,persistedEvents:0,droppedEvents:0,droppedEncodedBytes:0,firstLostEvent:null,cause:null,durableMarker:false},
   stats:{maxQueuedBytes:0,maxQueuedEntries:0,maxChunkBytes:0,maxFrameBytes:0,maxEventJSONBytes:0,maxEncodeMs:0,maxAppendMs:0,appendMs:0,encodedEvents:0,maxEncodeHeapDelta:0}});
  try {
   mkdirSync(root,{recursive:true});const lock=openSync(join(root,'writer.lock'),'wx');closeSync(lock);s.ownsRoot=true;
   atomic(root,'identity.json',identity,io);
   s.fd=openSync(join(root,'raw.chunks'),'wx');
   s.publish();s.append({type:'identity',...identity});
  }catch(error){s.fail(error);}
  return s;
 }
 fail(error) {
  this.health.state='incomplete';this.health.cause ??= `${error.code??'I/O'}: ${error.message}`;
  this.marker();
 }
 marker() {
  if(!this.ownsRoot)return;
  try {atomic(this.root,'INCOMPLETE.json',this.health,this.io);this.health.durableMarker=true;}
  catch {this.health.durableMarker=false;}
 }
 drop(size) {
  this.health.firstLostEvent ??= this.health.observed;
  this.health.droppedEvents++;this.health.droppedEncodedBytes+=size;
 }
 append(event) {
  const start=performance.now();this.health.observed++;let raw;
  try {
   const heap=process.memoryUsage().heapUsed;const t=performance.now();raw=Buffer.from(JSON.stringify(event));
   this.stats.maxEncodeMs=Math.max(this.stats.maxEncodeMs,performance.now()-t);
   this.stats.maxEncodeHeapDelta=Math.max(this.stats.maxEncodeHeapDelta,process.memoryUsage().heapUsed-heap);
   this.stats.maxEventJSONBytes=Math.max(this.stats.maxEventJSONBytes,raw.length);this.stats.encodedEvents++;
   if(this.health.state!=='healthy'){this.drop(raw.length);return {captured:false,health:this.health.state};}
   const id=this.event+1;let part=0;
   for(let offset=0;offset<raw.length;offset+=LIMIT.chunk) {
    const data=raw.subarray(offset,offset+LIMIT.chunk);
    const value={seq:this.seq+1,prev:this.prev,event:id,part:part++,last:offset+data.length===raw.length,data:data.toString('base64')};
    const body=Buffer.from(envelope(value));if(body.length>LIMIT.frame)throw Error('internal frame bound');
    const frame=Buffer.allocUnsafe(body.length+4);frame.writeUInt32BE(body.length);body.copy(frame,4);
    const frameOffset=this.bytes;
    writeAll(this.fd,frame,this.io.write,this.bytes);
    this.lastOffset=frameOffset;this.bytes+=frame.length;this.seq++;this.prev=JSON.parse(body).hash;
    this.stats.maxChunkBytes=Math.max(this.stats.maxChunkBytes,data.length);this.stats.maxFrameBytes=Math.max(this.stats.maxFrameBytes,frame.length);
   }
   this.event=id;this.health.persistedEvents++;
   if(event.type==='agent_settled')this.settled=true;
   if(event.type==='state' && event.state==='completed')this.completed=true;
   this.publish();return {captured:true};
  }catch(error) {
   // An index failure can leave a fully persisted event; do not report it as dropped.
   if(this.health.persistedEvents<this.health.observed)this.drop(raw?.length??0);
   this.fail(error);return {captured:false,health:this.health.state};
  }finally{const ms=performance.now()-start;this.stats.appendMs+=ms;this.stats.maxAppendMs=Math.max(this.stats.maxAppendMs,ms);}
 }
 publish() { atomic(this.root,'head.json',{identity:this.identity,seq:this.seq,hash:this.prev,bytes:this.bytes,lastOffset:this.lastOffset,events:this.event,completed:this.settled&&this.completed},this.io); }
 close() {if(this.health.state!=='healthy')this.marker();if(this.fd!==undefined){try{closeSync(this.fd);}catch(error){this.fail(error);}this.fd=undefined;}}
}
function readExact(fd,size,position,stats) {
 const b=Buffer.alloc(size);let n=0;
 while(n<size){const got=readSync(fd,b,n,size-n,position+n);stats.reads++;stats.bytes+=got;stats.maxReadBytes=Math.max(stats.maxReadBytes,got);if(!got)throw Error('partial chunk/frame');n+=got;}
 return b;
}
function frameAt(fd,offset,stats) {
 const n=readExact(fd,4,offset,stats).readUInt32BE();if(n<1||n>LIMIT.frame)throw Error('frame byte bound/corruption');
 const record=decode(readExact(fd,n,offset+4,stats));return {...record,next:offset+4+n};
}
function metadata(root,name,stats) {
 const path=join(root,name);const size=statSync(path).size;if(size>LIMIT.metadata)throw Error('metadata byte bound');
 const fd=openSync(path,'r');try{return decode(readExact(fd,size,0,stats)).value;}finally{closeSync(fd);}
}
export class Reader {
 constructor(root,parent){Object.assign(this,{root,parent,stats:{bytes:0,reads:0,maxReadBytes:0},warnings:[],readOnly:true,executable:false});}
 open() {
  const start=performance.now();
  try {
   this.identity=metadata(this.root,'identity.json',this.stats);
   if(this.identity.parent!==this.parent){this.filtered=true;return this;}
   this.head=metadata(this.root,'head.json',this.stats);
   if(JSON.stringify(this.identity)!==JSON.stringify(this.head.identity))throw Error('identity mismatch');
   if(!this.head.completed)this.warnings.push('INCOMPLETE: no durable completed capture');
   if(statSync(join(this.root,'raw.chunks')).size!==this.head.bytes)this.warnings.push('INCOMPLETE: raw/index high-water mismatch');
   if(this.head.seq) {
    const fd=openSync(join(this.root,'raw.chunks'),'r');try {
     const f=frameAt(fd,this.head.lastOffset,this.stats);
     if(f.value.seq!==this.head.seq||f.hash!==this.head.hash||f.next!==this.head.bytes)throw Error('raw/index tail mismatch');
    }finally{closeSync(fd);}
   }
  }catch(error){this.warnings.push(`INCOMPLETE: ${error.message}`);}
  if(!this.filtered)try{this.failure=metadata(this.root,'INCOMPLETE.json',this.stats);this.warnings.push(`INCOMPLETE: ${this.failure.cause}; dropped observed events=${this.failure.droppedEvents}, encoded bytes=${this.failure.droppedEncodedBytes}`);}catch(error){if(error.code!=='ENOENT')this.warnings.push(`INCOMPLETE marker: ${error.message}`);}
  this.openMs=performance.now()-start;return this;
 }
 reconcile({maxFrames=Infinity}={}) {
  const start=performance.now();const warnings=[];const messages=[];let current,identity,settled=false,completed=false;
  let previous='root',nextSeq=1,nextEvent=1,part=0,parts=[],offset=0,frames=0,events=0,maxEventBytes=0,eventBytes=0;let fd;
  const stats={bytes:0,reads:0,maxReadBytes:0};
  const project=e=>{
   if(e.type==='identity'){identity=e;if(e.parent!==this.parent){this.filtered=true;return;}if(this.identity&&JSON.stringify(e)!==JSON.stringify({type:'identity',...this.identity}))throw Error('raw identity mismatch');}
   else if(!identity)throw Error('missing raw identity');
   if(e.type==='message_start'){current=structuredClone(e.message);messages.push(current);}
   if(e.type==='message_update'&&current?.role==='assistant'){
    const b=e.assistantMessageEvent;current.content??=[];
    if(!Number.isInteger(b.contentIndex)||b.contentIndex<0||b.contentIndex>10000)throw Error('content index');
    if(b.type==='text_start')current.content[b.contentIndex]={type:'text',text:''};
    if(b.type==='text_delta'){current.content[b.contentIndex]??={type:'text',text:''};current.content[b.contentIndex].text+=b.delta;}
    if(b.type==='text_end')current.content[b.contentIndex]={type:'text',text:b.content};
   }
   if(e.type==='message_end'){if(current){messages[messages.length-1]=e.message;current=undefined;}else messages.push(e.message);}
   if(e.type==='agent_settled')settled=true;
   if(e.type==='state'&&e.state==='completed')completed=true;
  };
  try {
   fd=openSync(join(this.root,'raw.chunks'),'r');const size=statSync(join(this.root,'raw.chunks')).size;
   while(offset<size && frames<maxFrames){
    const f=frameAt(fd,offset,stats);const r=f.value;
    if(r.seq!==nextSeq||r.prev!==previous||r.event!==nextEvent||r.part!==part)throw Error('sequence/chunk order');
    const data=Buffer.from(r.data,'base64');if(data.length>LIMIT.chunk)throw Error('chunk byte bound');
    parts.push(data);eventBytes+=data.length;part++;frames++;offset=f.next;nextSeq++;previous=f.hash;
    if(r.last){maxEventBytes=Math.max(maxEventBytes,eventBytes);const event=JSON.parse(Buffer.concat(parts).toString('utf8'));project(event);events++;nextEvent++;part=0;parts=[];eventBytes=0;if(this.filtered)break;}
   }
   if(parts.length)warnings.push('INCOMPLETE: partial event chunks; only verified complete events projected');
   if(offset<size&&!this.filtered)warnings.push('INCOMPLETE: bounded prefix only; more retained bytes require explicit scan');
  }catch(error){warnings.push(`INCOMPLETE: ${error.message}; verified prefix retained`);}
  finally{if(fd!==undefined)closeSync(fd);}
  if(parts.length&&!warnings.some(w=>w.includes('partial event')))warnings.push('INCOMPLETE: partial event chunks; only verified complete events projected');
  if(current)warnings.push('INCOMPLETE: unfinished message');
  if(!settled||!completed)warnings.push('INCOMPLETE: no reconciled terminal state');
  return {identity,filtered:!!this.filtered,messages:this.filtered?[]:messages,warnings:[...this.warnings,...warnings],frames,events,offset,stats,maxEventBytes,ms:performance.now()-start,completed:completed&&settled&&!warnings.length&&!this.warnings.length,readOnly:true,executable:false};
 }
 prefix(){return this.reconcile({maxFrames:LIMIT.prefixFrames});}
}
