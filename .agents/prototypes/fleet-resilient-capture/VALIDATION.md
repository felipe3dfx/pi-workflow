# Validation and handoff

**Worker Verdict: done — focused reference experiment completed, repeated drivers and full repository gate passed.** This is not a production implementation verdict. Recommended disposition `reference-only`; user-confirmed disposition pending. `REPORT.md` gives the decisive synthesis and unapplied proposed contract delta.

## Preconditions and coverage

Read `AGENTS.md`, ordered agent contracts, glossary/ADR 0016, prototype/codebase-design/TypeScript/writing/TDD skills, applicable TypeScript error/async/module references, TDD valuable-test rubric, `test/support/README.md`, integrated REPORT/VALIDATION/store/case/provider/run and earlier normalized capture/recovery implementation. Repository-native APIs and checks were used; no install or external service was required.

Initial `git status --short`: only `?? .agents/prototypes/`, explicitly expected by the task. Before implementation, hashed every preexisting prototype file. All edits are new files under this directory.

`PLAN.md` records agreed seams, independently sourced literal expectations and coverage before implementation. Coverage lines are all tested: large admission/final reconciliation; actual runtime completion and lifecycle independence under success/positive-short/reject/partial/zero/index/all-block/no-storage; identity/filtering/bounded access/corruption/partial-event warnings; live/durable health and explicit loss. No behavior line is represented as skipped/GREEN. Production scenarios listed in REPORT are outside this bounded research, not silently counted as passed.

## Baseline and reproducible RED

```sh
npm run check > .agents/prototypes/fleet-resilient-capture/quality-baseline.txt 2>&1
```

Observed exit **0**, **18.4 s**: 949 tests, 935 passed, 14 skipped, 0 failed; packed distribution passed. Full output retained.

```sh
node .agents/prototypes/fleet-resilient-capture/baseline-red.mjs > .agents/prototypes/fleet-resilient-capture/baseline-red.txt 2>&1
```

Observed exit **1**, **0.1 s**, intentional behavioral assertion RED against the unchanged integrated Store: `Got unwanted rejection: audit event size must not refuse the producer`, actual `REFUSED: event/queue byte or entry bound; producer must stop`. The helper creates/removes its own tmp root. Same 300000-T event shape is GREEN in `assert.mjs` with exact readback.

## Development iterations, disclosed

1. `node .agents/prototypes/fleet-resilient-capture/assert.mjs > .agents/prototypes/fleet-resilient-capture/assertions-dev.json`: exit **1**, **0.1 s**, missing `partial event` warning when a frame read throws while a multi-chunk event is pending. Fixed by emitting pending-event status after the catch as well as at bounded scan exit. Existing partial-frame warning was not sufficient for that expectation.
2. `node .agents/prototypes/fleet-resilient-capture/run.mjs > .agents/prototypes/fleet-resilient-capture/runtime-dev.json`: exit **0**, **21.4 s**, 16 SDK/RPC scenarios passed.
3. After the warning fix, setup-error containment and explicit accounting/write-disable assertions:

```sh
node .agents/prototypes/fleet-resilient-capture/assert.mjs > .agents/prototypes/fleet-resilient-capture/assertions-dev.json && node .agents/prototypes/fleet-resilient-capture/run.mjs > .agents/prototypes/fleet-resilient-capture/runtime-dev.json
```

Observed exit **0**, **21.4 s**. Both drivers passed. Added independent parent-process reopen after writer exit and normal final stopReason assertions before final repetitions. This is an intentional baseline RED plus incremental research validation, not a claim that every final scenario had its own initial RED.

## Final repeated drivers, sequential

```sh
node .agents/prototypes/fleet-resilient-capture/assert.mjs > .agents/prototypes/fleet-resilient-capture/assertions-1.json && node .agents/prototypes/fleet-resilient-capture/run.mjs > .agents/prototypes/fleet-resilient-capture/runtime-1.json && node .agents/prototypes/fleet-resilient-capture/assert.mjs > .agents/prototypes/fleet-resilient-capture/assertions-2.json && node .agents/prototypes/fleet-resilient-capture/run.mjs > .agents/prototypes/fleet-resilient-capture/runtime-2.json && node -e 'for(const f of ["assertions-1","runtime-1","assertions-2","runtime-2"]){const r=JSON.parse(require("fs").readFileSync(`.agents/prototypes/fleet-resilient-capture/${f}.json`));console.log(f,r.assertions,r.samples?.length??"");}'
```

Observed exit **0**, **43.6 s**. Both assertion files report passed admission, larger UTF-8 final replacement, identity/current-parent, bounded access, corruption/partial chunks, oversized header and read-only recovery. Both runtime files report **16 passing cases each**, including independent read-only reopen/reconciliation after writer subprocess exit. Every actual agent finishes normally with exact 180000 assistant / 300000 tool characters, `stopReason: stop`, settled, and zero abort/steer/followUp controls. Healthy and positive-short-write captures retain exact finals; injected failures show explicit prefix/loss/health results. REPORT tables use only these final repeated files, not development timing.

## Complete repository quality gate, after drivers

```sh
npm run check > .agents/prototypes/fleet-resilient-capture/quality-final.txt 2>&1
```

Observed exit **0**, **18.7 s**, run strictly after both driver repetitions (not in parallel). **949 tests / 935 passed / 14 skipped / 0 failed**, test duration **15553.429802 ms**; packed distribution validation passed. All declared stages ran: Biome, TypeScript, Knip, focused-test guard, publish/release validators, tests and packed distribution. Biome has only four preexisting warnings in repository test files, as on baseline. No production source changed. REPORT/VALIDATION prose was written after this gate; no behavioral source changed after the final drivers/gate.

The repository gate does not execute these research drivers; driver results are separate evidence. Mutation testing is repository-declared unsupported and was not run.

## Byte-for-byte preservation and cleanup

Before implementation:

```sh
find .agents/prototypes -type f ! -path '.agents/prototypes/fleet-resilient-capture/*' -print0 | sort -z | xargs -0 sha256sum > .agents/prototypes/fleet-resilient-capture/preserved-before.sha256
```

After final runs:

```sh
find .agents/prototypes -type f ! -path '.agents/prototypes/fleet-resilient-capture/*' -print0 | sort -z | xargs -0 sha256sum > .agents/prototypes/fleet-resilient-capture/preserved-after.sha256
cmp .agents/prototypes/fleet-resilient-capture/preserved-before.sha256 .agents/prototypes/fleet-resilient-capture/preserved-after.sha256 && sha256sum -c .agents/prototypes/fleet-resilient-capture/preserved-before.sha256 > .agents/prototypes/fleet-resilient-capture/preservation-check.txt
```

Observed exit **0**: identical manifests and **all 64 preexisting prototype files OK**, including every integrated artifact. `preservation-check.txt` retains each result. `git diff --exit-code` returned **0**; `git status --short` still showed only `?? .agents/prototypes/`. No unrelated edits occurred. Existing artifacts were imported/read only.

Every driver removes its owned mkdtemp tree in finally; runtime drivers limit cleanup signals to their own forked fixture process groups. Actual SDK/RPC resources use owned isolated HOME/agent roots, offline mode and no real sessions/credentials. No git/gh mutation, paid calls, network provider, installs, production/config/ADR/glossary/brief edits or external writes occurred.

## Handoff

Nothing remains to run for this bounded experiment. User acceptance of the proposed contract/brief delta is still required before any application. Async scheduling/overload, production allocation/durability/index/UI design and transport selection remain explicitly outside this completed research. There is no unresolved blocking product question for the admission/failure-policy decision. Parent independent verification follows separately.
