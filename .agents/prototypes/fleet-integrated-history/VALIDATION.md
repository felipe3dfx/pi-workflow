# Validation / bounded handoff

Worker Verdict: **partial** — reproducible end-to-end subset demonstrated and required checks ran; arbitrary-size capture/display, full UI parity and production lifecycle remain explicitly unsupported. Recommended disposition reference-only; new user-confirmed disposition pending.

## Final prototype drivers (sequential)

From repository root, this exact shell chain exited **0** in **145.8 seconds**:

```sh
node .agents/prototypes/fleet-integrated-history/assert.mjs > .agents/prototypes/fleet-integrated-history/assertions-3.json && node .agents/prototypes/fleet-integrated-history/run.mjs > .agents/prototypes/fleet-integrated-history/streams-3.json && python3 .agents/prototypes/fleet-integrated-history/pty-run.py > .agents/prototypes/fleet-integrated-history/pty-3.json && node .agents/prototypes/fleet-integrated-history/assert.mjs > .agents/prototypes/fleet-integrated-history/assertions-4.json && node .agents/prototypes/fleet-integrated-history/run.mjs > .agents/prototypes/fleet-integrated-history/streams-4.json && python3 .agents/prototypes/fleet-integrated-history/pty-run.py > .agents/prototypes/fleet-integrated-history/pty-4.json
```

Results, twice with identical behavior:
- `assert.mjs`: passed 0/2k/10k history bounds, separately measured build/full scan/prefix fallback, every synthetic ordinal reachable, final replacement, parent/root isolation, actual cross-process writer refusal, byte/entry queue refusal, cumulative display limit and oversized text/tool-event refusal.
- `run.mjs`: each file passed 12 actual SDK/RPC cases with 2,000 retained messages, thinking/toolcall/result/final events, explicit unsupported partials, three SIGKILL boundaries, retained acknowledged byte/hash boundary, damage/tail detection, filtering/order/nonduplication, actual large-text and large-tool stop/refusal. No execution recovery.
- `pty-run.py`: each file passed four real Pi TUI/Linux PTY cases (two SDK and two RPC), six correlated input probes each, same capture/read/render policy, bounded resident entries/bytes, detach/follow and ordinal-toggle anchor. Plain text renderer, message paging rather than row-complete transcript scrolling.

Earlier successful shell chains producing files 1/2 ran in 71.8 / 73.1 seconds. They are development iterations, not accepted final measurements: 1's assertion accounting included later navigation in its reported byte/read totals; 2 corrected that; 3/4 added bounded missing-index raw-prefix fallback. Initial failures: an ordinary-stream assertion rejected a too-small outer queue (exit 1); Python file `pty.py` shadowed stdlib `pty` (exit 1), corrected by renaming. These are disclosed, not hidden or claimed as full test-first development.

## Complete repository quality gate

After all JSON writers finished, ran **`npm run check`**, redirected to `/tmp/fleet-integrated-check.log`: exit **0**, **18.5 seconds**, 949 tests / 935 passed / 14 skipped / 0 failed, packed distribution passed. Biome reported three new unused-import warnings plus four preexisting warnings. Removed only the three unused imports in this NEW artifact; no behavioral code changed after final prototype measurements.

Then ran **`npm run check`** again, redirected to `/tmp/fleet-integrated-check-final.log`: exit **0**, **18.9 seconds**, **949 tests / 935 passed / 14 skipped / 0 failed**, test duration **15,611.60 ms**, packed distribution passed. Biome has only four preexisting warnings in repository test files. All declared stages ran: Biome, TypeScript, Knip, focused-test guard, publish/release validators, repository tests, packed distribution. `quality-gate.txt` retains the final complete output. The repository gate does NOT run these research drivers. Mutation testing is unsupported and was not run.

## Preservation / ownership

Initial `git status --short` showed only `?? .agents/prototypes/`. No unrelated changes were found before editing. Only NEW files under `.agents/prototypes/fleet-integrated-history/` were edited.

```sh
find .agents/prototypes/fleet-history-comparison .agents/prototypes/fleet-bounded-capture -type f -print0 | sort -z | xargs -0 sha256sum > .agents/prototypes/fleet-integrated-history/preserved-after.sha256
cmp .agents/prototypes/fleet-integrated-history/preserved-before.sha256 .agents/prototypes/fleet-integrated-history/preserved-after.sha256 && sha256sum -c .agents/prototypes/fleet-integrated-history/preserved-before.sha256
```

Observed exit **0**: every existing artifact file reports **OK**, and manifests are identical. Post-gate `git status --short` still shows only `?? .agents/prototypes/`. No git/gh mutation, installs, publication, production edits or provider network/credential use. Isolated temporary roots were removed; only owned process groups were killed/reaped. Independent verification remains with parent.

Remaining limitations and the one possible material product choice are in `REPORT.md`; they are not implied approved requirements. No approved UI contract was created.
