import { writeFileSync } from 'node:fs';
import { open, mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Capture, normalize, recover } from '../fleet-bounded-capture/capture.mjs';
export { normalize };
export const LIMIT = { event: 220 * 1024, queueBytes: 512 * 1024, queueEntries: 64, message: 96 * 1024, windowEntries: 8, windowBytes: 192 * 1024, head: 8192 };
const hash = x => createHash('sha256').update(x).digest('hex');
const encoded = value => { const payload = JSON.stringify(value); return JSON.stringify({ payload, hash: hash(payload) }); };
const decoded = raw => { const e = JSON.parse(raw); if(hash(e.payload) !== e.hash) throw Error('checksum'); return JSON.parse(e.payload); };
async function atomic(root, name, value) { await writeFile(join(root, `${name}.tmp`), encoded(value)); await rename(join(root, `${name}.tmp`), join(root, name)); }
// New root only. Lock is intentionally NOT stolen after death. No multi-writer or resume API.
export class Store {
 static async create(root, identity) {
  await mkdir(root, { recursive: true });
  const lock = await open(join(root, 'writer.lock'), 'wx'); await lock.close();
  const s = new Store(); Object.assign(s, { root, identity, count: 0, current: undefined, warnings: new Set(), offset: 0, queuedBytes: 0, queuedEntries: 0, chain: Promise.resolve(), stats: { received: 0, refused: 0, maxQueueBytes: 0, maxQueueEntries: 0, publishMs: 0 } });
  await atomic(root, 'identity.json', identity);
  s.capture = await Capture.create(join(root, 'raw.capture'), identity);
  s.offset = (await stat(join(root, 'raw.capture'))).size; s.tailBytes = s.offset;
  await s.publish(1); return s;
 }
 append(event, afterAck) {
  this.stats.received++;
  const bytes = Buffer.byteLength(JSON.stringify(event)) * 2 + 1024;
  if(bytes > LIMIT.event || this.queuedBytes + bytes > LIMIT.queueBytes || this.queuedEntries >= LIMIT.queueEntries) {
   this.stats.refused++; this.warnings.add('producer refused: capture incomplete; stop producer, no retry/resume guarantee');
   writeFileSync(join(this.root, 'REFUSED'), 'INCOMPLETE: event or queue admission refused; producer must stop. Raw accepted prefix retained.');
   throw Error('REFUSED: event/queue byte or entry bound; producer must stop');
  }
  const copy = structuredClone(event);
  this.queuedBytes += bytes; this.queuedEntries++;
  this.stats.maxQueueBytes = Math.max(this.stats.maxQueueBytes, this.queuedBytes); this.stats.maxQueueEntries = Math.max(this.stats.maxQueueEntries, this.queuedEntries);
  const p = this.chain.then(async () => {
   const ack = await this.capture.append(copy); this.offset += ack.bytes; this.tailBytes = ack.bytes;
   if(afterAck) await afterAck(ack);
   this.project(copy); await this.publish(ack.seq); return ack;
  }).finally(() => { this.queuedBytes -= bytes; this.queuedEntries--; });
  this.chain = p; return p;
 }
 project(e) {
  if(e.type === 'message_start') this.current = { ordinal: this.count, message: structuredClone(e.message), incomplete: true };
  if(e.type === 'message_update' && this.current?.message?.role === 'assistant') {
   const b = e.assistantMessageEvent; const m = this.current.message; m.content ??= [];
   if(b.type === 'text_start') m.content[b.contentIndex] = { type: 'text', text: '' };
   if(b.type === 'text_delta') { m.content[b.contentIndex] ??= { type: 'text', text: '' }; m.content[b.contentIndex].text += b.delta; }
   if(b.type === 'text_end') m.content[b.contentIndex] = { type: 'text', text: b.content };
  }
  if(this.current && Buffer.byteLength(encoded(this.current)) > LIMIT.message) this.current = { ordinal: this.current.ordinal, incomplete: this.current.incomplete, unsupported: 'single-message display bound exceeded; raw retained' };
  if(e.type === 'unsupported_partial') this.warnings.add(`unsupported partial: ${e.kind}`);
  if(e.type === 'message_end') this.current = { ordinal: this.count++, message: structuredClone(e.message), incomplete: false };
  if(e.type === 'agent_settled') this.settled = true;
  if(e.type === 'state') this.completed = e.state === 'completed';
 }
 async publish(seq) {
  const start = performance.now(); let live;
  if(this.current) {
   let entry = this.current;
   if(Buffer.byteLength(encoded(entry)) > LIMIT.message) entry = { ordinal: entry.ordinal, incomplete: entry.incomplete, unsupported: 'single-message display bound exceeded; raw evidence retained, full expansion refused' };
   live = this.current.incomplete ? `live-${seq}.json` : `m-${this.current.ordinal}.json`;
   await atomic(this.root, live, { seq, entry });
   if(!this.current.incomplete) this.current = undefined;
  }
  this.live = this.current ? live : undefined;
  await atomic(this.root, 'head.json', { identity: this.identity, count: this.count, live: this.live, seq, offset: this.offset, tailBytes: this.tailBytes, rawHash: this.capture.prev, warnings: [...this.warnings], completed: !!(this.settled && this.completed) });
  this.stats.publishMs += performance.now() - start;
 }
 async close() { await this.chain; await this.capture.close(); }
}
export class Reader {
 constructor(root, parent) { Object.assign(this, { root, parent, follow: true, entries: [], warnings: [], stats: { bytes: 0, reads: 0 }, hidden: true }); }
 async read(name, limit) {
  const path = join(this.root, name); const size = (await stat(path)).size;
  if(size > limit) throw Error(`${name}: byte bound`);
  const raw = await readFile(path, 'utf8'); if(Buffer.byteLength(raw) > limit) throw Error('concurrent oversized read');
  this.stats.bytes += Buffer.byteLength(raw); this.stats.reads++; return decoded(raw);
 }
 async open() {
  const start = performance.now(); this.entries = []; this.warnings = [];
  try {
   const identity = await this.read('identity.json', LIMIT.head);
   this.identity = identity;
   if(identity.parent !== this.parent) { this.filtered = true; return this; }
   this.head = await this.read('head.json', LIMIT.head);
   if(JSON.stringify(identity) !== JSON.stringify(this.head.identity)) throw Error('identity mismatch');
   this.warnings.push(...this.head.warnings);
   try { await stat(join(this.root, 'REFUSED')); this.warnings.push('INCOMPLETE: producer admission refused; raw retained prefix only'); } catch(e) { if(e.code !== 'ENOENT') throw e; }
   if(!this.head.completed) this.warnings.push('INCOMPLETE: terminal metadata absent');
   if((await stat(join(this.root, 'raw.capture'))).size !== this.head.offset) this.warnings.push('INCOMPLETE: raw/index high-water mismatch; explicit recovery required');
   try {
    const n = this.head.tailBytes;
    if(!Number.isInteger(n) || n < 1 || n > 256*1024 || this.head.offset < n) throw Error('tail bound');
    const file = await open(join(this.root, 'raw.capture'), 'r');
    try {
     const buf = Buffer.alloc(n); let got = 0;
     while(got < n) { const r = await file.read(buf, got, n-got, this.head.offset-n+got); if(!r.bytesRead)throw Error('short raw tail'); got += r.bytesRead; }
     this.stats.bytes += n; this.stats.reads++;
     const raw = buf.toString('utf8').trimEnd(); const e = decoded(raw);
     if(e.seq !== this.head.seq || JSON.parse(raw).hash !== this.head.rawHash)throw Error('raw tail/head mismatch');
    } finally { await file.close(); }
   } catch(e) { this.warnings.push(`INCOMPLETE: raw tail: ${e.message}`); }
   this.end = this.head.count; await this.load();
  } catch(e) {
   this.warnings.push(`INCOMPLETE: ${e.message}; bounded prefix fallback, not an ordinary open or full repair`);
   await this.prefix();
  }
  finally { this.openMs = performance.now() - start; }
  return this;
 }
 async prefix() {
  const start=performance.now();this.entries=[];
  try {
   const file=await open(join(this.root,'raw.capture'),'r');const buf=Buffer.alloc(64*1024);let n;
   try { n=(await file.read(buf,0,buf.length,0)).bytesRead; } finally { await file.close(); }
   this.stats.bytes+=n;this.stats.reads++;
   const lines=buf.subarray(0,n).toString('utf8').split('\n');lines.pop();
   let previous='root';let next=1;
   const projection={count:0,current:undefined,warnings:new Set()};
   for(const line of lines) {
    const envelope=JSON.parse(line);const record=decoded(line);
    if(record.seq!==next || record.prev!==previous)throw Error('prefix chain');
    previous=envelope.hash;next++;
    if(record.seq===1) {
     if(record.event.type!=='identity')throw Error('prefix identity missing');
     if(record.event.parent!==this.parent){this.filtered=true;this.entries=[];return;}
     if(this.identity && JSON.stringify(this.identity)!==JSON.stringify(Object.fromEntries(Object.entries(record.event).filter(([k])=>k!=='type'))))throw Error('prefix identity mismatch');
     this.identity=record.event;continue;
    }
    Store.prototype.project.call(projection,record.event);
    if(record.event.type==='message_end') {this.entries.push(projection.current);projection.current=undefined;}
    if(this.entries.length>=LIMIT.windowEntries)break;
   }
   if(projection.current && this.entries.length<LIMIT.windowEntries)this.entries.push(projection.current);
   this.warnings.push('INCOMPLETE: validated earliest raw prefix only (64 KiB / 8 entries); newer retained bytes may exist; explicit full diagnostic required');
  }catch(e){this.warnings.push(`INCOMPLETE raw prefix: ${e.message}`);}
  finally{this.prefixRecoveryMs=performance.now()-start;this.residentBytes=Buffer.byteLength(JSON.stringify(this.entries));}
 }
 async load() {
  this.entries = []; let bytes = 0;
  const names = [];
  if(this.follow && this.head.live) names.push(this.head.live);
  for(let n = this.end - 1; n >= 0 && names.length < LIMIT.windowEntries; n--) names.push(`m-${n}.json`);
  for(const name of names) {
   try {
    const size = (await stat(join(this.root, name))).size;
    if(bytes + size > LIMIT.windowBytes) break;
    const v = await this.read(name, LIMIT.message + 1024); bytes += size;
    if(v.seq > this.head.seq) throw Error('entry newer than head');
    this.entries.unshift(v.entry);
   } catch(e) { this.warnings.push(`INCOMPLETE: ${name}: ${e.message}`); break; }
  }
  this.residentBytes = bytes;
 }
 async move(delta) { if(!this.head)return; this.follow = false; this.end = Math.max(1, Math.min(this.head.count, this.end + delta)); await this.load(); }
 async refresh() { if(this.follow) await this.open(); }
 toggle() { this.hidden = !this.hidden; }
}
export async function diagnosticReplay(root, parent) { const start = performance.now(); const r = await recover(join(root, 'raw.capture'), parent); return { ...r, totalMs: performance.now() - start, operation: 'explicit full raw diagnostic scan; no index repair, no execution' }; }
