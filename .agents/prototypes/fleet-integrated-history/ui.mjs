import { ProcessTerminal, TuiMainScreen, truncateToWidth } from '@earendil-works/pi-tui';
import { initTheme } from '@earendil-works/pi-coding-agent';
import { Reader } from './store.mjs';
export async function startUI(root, log) {
 initTheme('dark', false);
 const terminal = new ProcessTerminal(); const tui = new TuiMainScreen(terminal);
 let reader = await new Reader(root, 'parent-1').open(); let seq = 0; let busy = Promise.resolve(); let stopped = false; let refreshing = false; let pendingInputs = 0;
 const write = terminal.write.bind(terminal);
 terminal.write = text => { write(text); for(const m of text.matchAll(/INTEGRATED_(\d+)_END/g)) log({ type: 'write', seq: Number(m[1]) }); };
 const view = { render(width) {
  const start = performance.now();
  const lines = [`INTEGRATED_${seq}_END`, `${reader.follow ? 'follow' : 'detached'} ordinal ${reader.entries[0]?.ordinal ?? '-'} ${reader.warnings.length ? 'INCOMPLETE' : ''}`, ...reader.warnings];
  for(const e of reader.entries) {
   lines.push(`[${e.ordinal}] ${e.incomplete ? 'INCOMPLETE' : 'final'}`);
   if(e.unsupported) lines.push(e.unsupported);
   else for(const b of (Array.isArray(e.message.content) ? e.message.content : [{ type: 'text', text: e.message.content }])) {
    if(b.type === 'thinking') lines.push(reader.hidden ? '(thinking collapsed)' : b.thinking);
    else if(b.type === 'text') lines.push(b.text);
    else lines.push(`${b.type}: ${b.name ?? 'unsupported'}`);
   }
  }
  const rows = lines.flatMap(l => String(l).split('\n').flatMap(row => { const a=[]; for(let i=0;i<row.length;i+=width) a.push(row.slice(i,i+width)); return a.length?a:['']; }));
  log({ type: 'render', seq, ms: performance.now()-start, entries: reader.entries.length, residentBytes: reader.residentBytes });
  return [...rows.slice(0,2), ...(reader.follow ? rows.slice(2).slice(-36) : rows.slice(2,38))].map(l => truncateToWidth(l,width));
 }, invalidate() {}, handleInput(data) {
  if(pendingInputs >= 8) { log({type:'input_refused', reason:'8-entry input queue bound'}); return; }
  pendingInputs++;
  busy = busy.then(async () => {
   pendingInputs--;
   log({ type: 'input', data, seq: ++seq });
   if(data === '\x1b[5~') await reader.move(-1);
   else if(data === '\x1b[6~') await reader.move(1);
   else if(data === '\x14') reader.toggle();
   else if(data === 'f' || data === '\r') reader = await new Reader(root,'parent-1').open();
   log({ type: 'action', seq, follow: reader.follow, anchor: reader.entries[0]?.ordinal, warnings: reader.warnings, entries: reader.entries.length }); tui.requestRender();
  });
 } };
 tui.addChild(view); tui.setFocus(view); tui.start();
 return { async refresh() { if(stopped || refreshing)return; refreshing=true; busy = busy.then(async()=>{ try { await reader.refresh(); tui.requestRender(); } finally { refreshing=false; } }); await busy; }, async stop() { stopped=true; await busy; tui.stop(); } };
}
