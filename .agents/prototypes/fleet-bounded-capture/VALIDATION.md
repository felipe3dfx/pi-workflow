# Observed validation

Commands ran from repository root, no dependency installation. Durations are tool wall times where available.

- `npm run check > /tmp/fleet-initial-check.log 2>&1`: passed before implementation; 18.6 s wrapper; 935 passed, 14 skipped, zero failed; packed distribution passed.
- `node .agents/prototypes/fleet-bounded-capture/assert-history.mjs > .agents/prototypes/fleet-bounded-capture/history-red.txt 2>&1`: retained assertion failure: expected `/INCOMPLETE/`, got `[m-1968]`. The surrounding shell printed the failure and exited zero; this is assertion RED, not a claimed passing test.
- `node .agents/prototypes/fleet-bounded-capture/assert-history.mjs > .agents/prototypes/fleet-bounded-capture/history-assertions-1.json`: passed after warning propagation; repeated as history-assertions-2.json through history-assertions-5.json. Later versions add complete row backscroll and 10,000-message index recovery assertions.
- `python3 .agents/prototypes/fleet-bounded-capture/history-run.py > .agents/prototypes/fleet-bounded-capture/history-evidence.json`: final successful first driver version exited 0, 58.4 s. Earlier attempts failed missing correlation assertions under input coalescing; final driver waits for each written marker.
- `python3 .agents/prototypes/fleet-bounded-capture/history-run.py > .agents/prototypes/fleet-bounded-capture/history-evidence-2.json`: exited 0, 75.7 s; continuous row paging and demand-load assertion.
- `python3 .agents/prototypes/fleet-bounded-capture/history-run.py > .agents/prototypes/fleet-bounded-capture/history-evidence-3.json`: exited 0, 75.0 s; final instrumentation, 18 matched cases, 216 probes.
- `node .agents/prototypes/fleet-bounded-capture/capture-run.mjs > .agents/prototypes/fleet-bounded-capture/capture-evidence-1.json`: exited 0, 20.9 s; 16 capture cases. Earlier attempts failed because completion evidence was disconnected before IPC send finished; fixed by awaiting the send callback.
- `node .agents/prototypes/fleet-bounded-capture/capture-run.mjs > .agents/prototypes/fleet-bounded-capture/capture-evidence-2.json`: passed with lag and complete-tail-removal checks.
- `node .agents/prototypes/fleet-bounded-capture/capture-run.mjs > .agents/prototypes/fleet-bounded-capture/capture-evidence-3.json`: passed with additional Group/parent discovery checks; final 16 cases plus reconciliation/discovery assertions. This command and the preceding assertion driver took 22.3 s together.
- `npm run check > /tmp/fleet-new-check.log 2>&1`: passed post-implementation, 24.5 s wrapper; 935 passed, 14 skipped, zero failed; packed distribution passed. One new optional-chain warning was subsequently fixed.
- `npm run check > /tmp/fleet-final-check.log 2>&1`: exited 1 at Biome, 0.5 s, because the gate ran concurrently with redirects temporarily creating empty history-assertions-5.json and history-evidence-3.json. No suppression/configuration change was made.
- **Final sequential gate:** `npm run check > /tmp/fleet-final-sequential-check.log 2>&1`: exited 0, 18.3 s; 949 tests, 935 passed, 14 skipped, zero failed; test duration 15142.573163 ms; packed distribution validation passed. Existing unrelated Biome warnings remain nonblocking.
- `diff -u .agents/prototypes/fleet-bounded-capture/preserved-before.sha256 .agents/prototypes/fleet-bounded-capture/preserved-after.sha256`: exited 0, no differences.
- `sha256sum -c .agents/prototypes/fleet-bounded-capture/preserved-before.sha256`: exited 0, all 15 accepted files OK, repeated after final evidence generation.
- `git diff --stat`: empty; read-only status filtering found no changes outside `.agents/prototypes/`.
- Final Python JSON inspection: all new JSON files parse; final evidence contains 18 PTY cases, 216 probes, 16 capture cases.

Repository gate excludes prototype execution from its tests/typecheck/Knip scope; explicit drivers provide prototype assertions. Mutation testing is unsupported and was not run. Limitations and outstanding research are in REPORT.md; no production readiness, full Pi parity, physical-display latency, fsync guarantee, or SDK/RPC decision is claimed.
