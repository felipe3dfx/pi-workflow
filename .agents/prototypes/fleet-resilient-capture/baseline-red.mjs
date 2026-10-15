import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../fleet-integrated-history/store.mjs';
const root = await mkdtemp(join(tmpdir(), 'fleet-admission-red-'));
try {
 const store = await Store.create(root, {parent:'parent-1', child:'child-0'});
 try {
  await assert.doesNotReject(async () => store.append({type:'message_end',message:{role:'toolResult',content:[{type:'text',text:'T'.repeat(300000)}]}}), 'audit event size must not refuse the producer');
 } finally { await store.close(); }
} finally { await rm(root,{recursive:true,force:true}); }
