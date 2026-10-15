import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { History, build, rebuildHead } from "./history.mjs";
initTheme("dark", false);
const root = await mkdtemp(join(tmpdir(), "fleet-pages-"));
try {
 const built = await build(root, 2000);
 const h = new History(root); await h.open();
 assert.deepEqual(h.entries.map(e => e.ordinal), [1984,1985,1986,1987,1988,1989,1990,1991,1992,1993,1994,1995,1996,1997,1998,1999]);
 assert.equal(h.stats.parsedMessages, 16); assert.equal(h.stats.reads, 2);
 h.lines(55); const before = h.stats.layouts; h.toggle(); h.lines(55); assert.equal(h.stats.layouts - before, 16);
 h.toggle(); h.lines(55); assert.equal(h.stats.layouts - before, 16);
 h.receive("child-1", "UNSELECTED"); h.receive("child-0", "SELECTED"); assert.ok(h.lines(55).includes("SELECTED")); assert.ok(!h.lines(55).includes("UNSELECTED"));
 await h.move(-1); assert.ok(!h.lines(55).includes("SELECTED"));
 const seen = [];
 await h.end();
 for (;;) { seen.unshift(...h.entries.map(e => e.ordinal)); assert.ok(h.cache.size <= 3); if (!h.page) break; await h.move(-1); }
 assert.deepEqual(seen, Array.from({ length: 2000 }, (_,i) => i));
 await h.end(); const visibleIds = new Set(); let previousFirst=2000;
 for(let step=0;step<2000;step++) {
  const visible=h.viewport(55,35); const ids=visible.filter(l=>/^\[m-\d+\]$/.test(l)).map(l=>Number(l.match(/\d+/)[0]));
  if(ids.length){assert.ok(ids[0]<=previousFirst);previousFirst=ids[0];for(const id of ids)visibleIds.add(id);}
  if(h.page===0&&h.top===0)break;
  await h.scroll(-1,55,35);
 }
 assert.equal(visibleIds.size,2000,"every message must be reachable in the viewport, not only in page arrays");
 const good = await readFile(join(root,"124.json"));
 await rm(join(root,"124.json")); h.cache.clear(); await h.end(); assert.match(h.lines(55)[0], /INCOMPLETE/);
 await writeFile(join(root,"124.json"), "corrupt"); await h.load(); assert.match(h.lines(55)[0], /INCOMPLETE/);
 await writeFile(join(root,"124.json"), good); await h.load(); assert.equal(h.entries.length,16); assert.equal(h.warning,undefined);
 await rm(join(root,"head.json")); const recovery = await rebuildHead(root); assert.equal(recovery.count,2000);
 await writeFile(join(root,"124.json"), "corrupt"); const damagedRecovery = await rebuildHead(root);
 const damaged = new History(root); await damaged.open(); assert.match(damaged.lines(55)[0], /INCOMPLETE/);
 const empty = join(root,"empty"); await build(empty,0); const e = new History(empty); await e.open(); assert.deepEqual(e.entries,[]);
 const large=join(root,"large"); const largeBuild=await build(large,10000); await rm(join(large,"head.json")); const largeRecovery=await rebuildHead(large); assert.equal(largeRecovery.count,10000);
 console.log(JSON.stringify({ largeBuild, largeRecovery, assertions: "passed: bounds, order, no gaps/duplicates, toggle cache, selected/unselected, detached/follow, missing/corrupt/retry, recovery, empty", built, recovery, damagedRecovery, stats:h.stats }));
} finally { await rm(root,{recursive:true,force:true}); }
