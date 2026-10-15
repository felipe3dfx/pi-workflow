# Focused reference experiment

Question: can large observed events be retained without capture admission controlling agent lifecycle, and can storage failure yield visible incomplete history while the actual agent finishes normally?

Success: actual SDK and RPC/faux-provider runs each produce exact 180000-character assistant + 300000-character tool result; short writes retain exact output; write rejection and index publication failure disable capture, preserve readable prefix, and never invoke abort/cancel/steer. Bounded raw chunk access and zero queued event bytes are measured. Full reconciliation is explicit and not a bounded-memory normal open.

Scope: new directory only, read-only imports from prior prototypes. Synchronous chunk spooling is the minimal admission experiment, NOT a recommended production hot-path implementation. It trades a queue for synchronous filesystem latency. No arbitrary-size constant-memory claim: event JSON encoding allocates. No fsync, arbitrary throughput, production UI, repair or transport selection.

Coverage lines before implementation:
- Admission seam Store.append / recovered view: independent literals 180000 L and 300000 T; existing integrated Store RED rejects tool event; new Store must accept and reconcile without duplicate partials. Additional bounded Unicode payload checks UTF-8 framing.
- Actual agent subscribe/prompt seam: SDK and real RPC with local faux provider; exact final/result literals independent of storage; normal prompt completion and no capture lifecycle controls. Run success, positive short writes, ENOSPC-shaped write rejection, zero-progress short write, index rename failure, and all further I/O blocked.
- Reader seam: current-parent filtering and complete identity, bounded metadata/chunk page access, explicit diagnostic full reconciliation, final replacing delta; corruption/partial chunk stops at verified prefix, no execution API.
- Health seam: loss count/bytes (observed encoded event size), first lost event, disabled writes, live cause; durable marker if writable, generic incomplete evidence otherwise. Start with absolutely no writes tests live-only specificity and missing-record warning without pretending a durable identity or failure cause.

The supplied bounded task agrees these seams and cases. This is research with a reproducible baseline assertion RED followed by incremental driver validation, not a claim of exhaustive production TDD. Repository baseline gate precedes implementation. Final drivers run repeatedly, then npm run check sequentially. Existing artifacts are hashed before/after. Recommended disposition reference-only; confirmed disposition pending. No brief or approved UI contract edit.
