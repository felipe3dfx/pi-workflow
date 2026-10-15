import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Markdown } from "@earendil-works/pi-tui";

export const PAGE = 16;
const digest = (value) => createHash("sha256").update(value).digest("hex");
export function entry(id) {
 return { type: "message", id: `m-${id}`, ordinal: id, message: fauxAssistantMessage([{ type: "thinking", thinking: `reasoning ${id}` }, { type: "text", text: `history ${id}: ${"x".repeat(256)}` }]) };
}
export async function build(root, count) {
 const start = performance.now();
 await mkdir(root, { recursive: true });
 for (let first = 0; first < count; first += PAGE) {
  const entries = Array.from({ length: Math.min(PAGE, count - first) }, (_, i) => entry(first + i));
  const payload = JSON.stringify(entries);
  await writeFile(join(root, `${first / PAGE}.json`), JSON.stringify({ payload, hash: digest(payload) }));
 }
 await writeFile(join(root, "head.json"), JSON.stringify({ count, pageSize: PAGE, parent: "parent-1", child: "child-0", group: "launch-1" }));
 return { buildMs: performance.now() - start, messages: count, pages: Math.ceil(count / PAGE) };
}
export class History {
 constructor(root) { this.root = root; this.cache = new Map(); this.stats = { bytes: 0, reads: 0, parsedMessages: 0, readParseMs: 0, pageVerifyParseMs: 0, layouts: 0, layoutMs: 0 }; this.hidden = false; this.follow = true; this.live = new Map(); }
 async read(name) {
  const start = performance.now();
  const raw = await readFile(join(this.root, name), "utf8");
  this.stats.bytes += Buffer.byteLength(raw); this.stats.reads++;
  const value = JSON.parse(raw); this.stats.readParseMs += performance.now() - start; return value;
 }
 async open() { this.head = await this.read("head.json"); this.page = Math.max(0, Math.ceil(this.head.count / PAGE) - 1); return this.load(); }
 async load() {
  if (!this.head.count) { this.entries = []; return []; }
  try {
   if (!this.cache.has(this.page)) {
    const envelope = await this.read(`${this.page}.json`);
    const verifyStart=performance.now();
    if (digest(envelope.payload) !== envelope.hash) throw new Error("checksum mismatch");
    const entries = JSON.parse(envelope.payload);
    const first = this.page * PAGE;
    if (entries.length !== Math.min(PAGE, this.head.count - first) || entries.some((e, i) => e.ordinal !== first + i)) throw new Error("page order/length mismatch");
    this.stats.pageVerifyParseMs += performance.now()-verifyStart;
    this.stats.parsedMessages += entries.length;
    this.cache.set(this.page, { entries, lines: new Map() });
    while (this.cache.size > 3) this.cache.delete(this.cache.keys().next().value);
   }
   this.entries = this.cache.get(this.page).entries; this.warning = undefined;
  } catch (error) { this.entries = []; this.warning = `INCOMPLETE page ${this.page}: ${error.message}`; }
  return this.entries;
 }
 async move(delta) { this.follow = false; this.page = Math.max(0, Math.min(Math.ceil(this.head.count / PAGE) - 1, this.page + delta)); return this.load(); }
 async end() { this.follow = true; this.top = undefined; this.page = Math.max(0, Math.ceil(this.head.count / PAGE) - 1); return this.load(); }
 viewport(width, rows) {
  const lines = this.lines(width);
  if(this.follow || this.top === undefined) this.top = Math.max(0, lines.length - rows);
  this.top = Math.max(0, Math.min(this.top, lines.length - rows));
  return lines.slice(this.top, this.top + rows);
 }
 async scroll(direction, width, rows) {
  this.viewport(width,rows); this.follow = false;
  const length = this.lines(width).length;
  if(direction < 0) {
   if(this.top > 0) this.top = Math.max(0, this.top - rows);
   else if(this.page > 0) { await this.move(-1); this.top = Math.max(0,this.lines(width).length - rows); }
  } else if(this.top + rows < length) this.top = Math.min(length - rows, this.top + rows);
  else if(this.page + 1 < Math.ceil(this.head.count / PAGE)) { await this.move(1); this.top = 0; }
  return this.viewport(width,rows);
 }
 toggle() { this.hidden = !this.hidden; }
 receive(child, text) { this.live.set(child, text); }
 lines(width) {
  if (this.warning) return [this.warning];
  if (this.head.warnings?.length) return [`INCOMPLETE index recovery: ${this.head.warnings.join(", ")}`];
  const page = this.cache.get(this.page);
  const key = `${width}:${this.hidden}`;
  if (page && !page.lines.has(key)) {
   const start = performance.now();
   const lines = page.entries.flatMap((e) => {
    this.stats.layouts++;
    return [`[${e.id}]`, ...(this.hidden ? ["Thinking… (collapsed)"] : new Markdown(e.message.content[0].thinking, 0, 0, getMarkdownTheme()).render(width)), ...new Markdown(e.message.content[1].text, 0, 0, getMarkdownTheme()).render(width)];
   });
   page.lines.set(key, lines); while(page.lines.size > 4) page.lines.delete(page.lines.keys().next().value); this.stats.layoutMs += performance.now() - start;
  }
  return [...(page?.lines.get(key) ?? ["No history"]), ...(this.follow ? [this.live.get("child-0") ?? "Waiting for live text"] : [])];
 }
}
export async function rebuildHead(root) {
 const start = performance.now(); let count = 0; let bytes = 0;
 const names = (await readdir(root)).filter((n) => /^\d+\.json$/.test(n)).sort((a,b) => Number(a.split(".")[0])-Number(b.split(".")[0]));
 const warnings = [];
 for (const [index, name] of names.entries()) {
  try {
   if (name !== `${index}.json`) throw new Error("gap");
   const raw = await readFile(join(root, name), "utf8"); bytes += Buffer.byteLength(raw);
   const e = JSON.parse(raw); if (digest(e.payload) !== e.hash) throw new Error("checksum");
   count += JSON.parse(e.payload).length;
  } catch { warnings.push(`incomplete ${name}`); break; }
 }
 await writeFile(join(root, "head.json"), JSON.stringify({ count, pageSize: PAGE, parent: "parent-1", child: "child-0", group: "launch-1", warnings }));
 return { rebuildMs: performance.now() - start, bytes, count, warnings };
}
