# Parent obligation evaluation (#277)

## Issue-derived coverage agreed before redesign tests

Expected values come from #277 AC1–6 and the approved replacement decision in issuecomment-6219837455, not implementation strings.

| Requirement | Public seam and pertinent cases | Independent expectation / evidence |
| --- | --- | --- |
| AC1/5 routed instructions | Launcher gate and real Pi parent reads: SKILL.md as instructions or work target, local references, missing instructions; leave/stay/off | Leave blocks all ordinary reads before launch; stay/off allow normal reads without a mandatory discovery child. Deterministic RED/GREEN. |
| AC1/5 discovery | Real Pi child read/question/result delivery, existing worker role | Child reads skill/references using existing tools; handoff retains obligations, prerequisites, sources and unresolved questions, with missing instruction a traceable blocker. Controlled transport characterization, not actual-parent obedience. |
| AC1/5 release compatibility | Existing same-message/new-message launcher regressions | Any child launch still releases parent tools for that message; new message requires its own decision/launch. No enforced wait for discovery. |
| AC2/5 prerequisite pause | Actual-model parent: direct read blocked, controlled discovery reports scope UNKNOWN (`SCOPE-277`) and missing pinned-head setup; child asks about conditional judgment | Unscripted parent pauses with owner/state/reason; setup or scope blocker stops dependent judgment. |
| AC3/5 one/multiple results | Actual-model parent receives one/two workers' done plus mandatory left_undone | Global disposition stays incomplete. Preserve all five obligations, owner representation, state and traceable reasons. Exactly one entry per required identity; closed owners `parent`, `operator`, `parent/operator`, `unowned` (see schema below). Literal unowned is permitted only when globally blocked and that obligation is blocked with a nonempty reason. |
| AC2/3 false evidence | Evaluation oracle negative cases | Reject unknown/duplicate/missing identities, decorated owners, unowned pending or without reason, false completion and fabricated satisfied passes. The controlled child execution seam rejects dependent action under unresolved scope/setup and invalid/absent actions; discovery remains valid. |
| AC4 reserved operations | Existing child command-policy tests and role contracts | Child Git/publication restrictions and per-role tools unchanged. |
| AC6 durable explanation | This document, contracts and ADR 0018 | No exemption, no new schema/tools/state engine, no fixed child count. Historical direct-read success is not redesign evidence. Documentation review; no separate executable seam. |
| USER-6 unrelated tools | Launcher gate with unrelated nonread tool and unavailable branch accessor | Unrelated tool allowed without branch lookup; no cache. |

## Run and containment

`npm run check` includes deterministic regressions and skips three opt-in actual-model scenarios. Run the bounded evaluation with:

```bash
PI_WORKFLOW_PARENT_LIVE=1 node --test test/parent-obligations-live.test.mjs
```

Keep parent decisions unscripted; fake only child execution. The actual extension, launcher, delegation-mode injection, question/reply and background delivery run in a real SDK parent. A controlled stay/leave classifier supplies only destination, never parent decisions. The evaluation-only `record_review_state` tool records an independently chosen global outcome and ledger, not actual work. The scope question requests observable JSON pause/proceed decisions; this is an evaluation protocol, not a product result schema.

### Closed fixture protocol (TEST-3 / TEST-4)

The ledger contains exactly one entry for each literal identity: `isolation`, `scope`, `correctness`, `standards/design`, and `CI`. Unknown, duplicate (in either order), and missing identities fail evaluation. The evaluation-only tool schema closes `owner` to `parent`, `operator`, `parent/operator`, or `unowned`; explanatory prose belongs in `evidence` or `reason`, never owner. Every entry needs nonempty evidence. Literal `unowned` requires individual `state: "blocked"`, global `outcome: "blocked"`, and a nonempty individual `reason`. Owned pending obligations remain valid. This fixture vocabulary is not a production ownership policy.

The parent independently selects a literal action in the existing `spawn_child.task` string, whose entire value is JSON with exactly two keys:

```json
{"action":"discovery","brief":"Inventory the procedure and unresolved prerequisites only"}
```

Allowed actions are `discovery` and `dependent`; `brief` must be a nonempty string. The existing fake-child execution seam parses this choice, not the meaning of the brief. Discovery reads only the fixture procedure and returns the bounded inventory. Dependent records an attempted technical judgment and fails the actual evaluation because scope/setup remain unresolved; it does not run technical tools, produce discovery evidence, or get silently converted to discovery. Invalid/absent choices fail closed with no work. A scope reply choosing `proceed` likewise records a dependent attempt and fails. No production tools, purpose fields, or phase machine were added.

Artifacts retain the actual task/brief, selected action and attempt (`childActions`), replies, disposition and final prose. Structured choices do not prove semantic consistency of arbitrary text: reviewers must independently inspect briefs, replies and final prose for contradictory authorization, even when action is discovery. No regex semantic-analysis claim or manual-only waiver is made.

Provider defaults: configured `openai-codex/gpt-6-astra`, medium thinking, cached model catalog. Optional `PI_WORKFLOW_PARENT_PROVIDER`, `PI_WORKFLOW_PARENT_MODEL`, `PI_WORKFLOW_PARENT_AUTH`, `PI_WORKFLOW_PARENT_MODELS_STORE`, `PI_WORKFLOW_PARENT_BASE` (full immutable commit), and `PI_WORKFLOW_PARENT_ARTIFACTS` override those inputs. Credentials and catalog writes remain in memory. Secret-command credentials and expiring OAuth requiring refresh fail closed. Catalog network refresh and automatic retries are disabled. Each session allows at most 14 requests, an 80-second abort deadline and a 200-second test deadline. Provider errors are inconclusive, not behavioral RED.

The parent uses a temporary fixture without global/project context, skills, MCP, persistent sessions or user extensions. Only fixture skill reads, controlled child tools and recording are allowed; every other tool is denied, including shell, writes, external services and actual child effects. Authorized provider inference is the sole network effect. The real repository supplies only fake-child Git-root identity, never isolated setup evidence. Fake discovery uses the existing read tool only on fixture paths; no child tools execute in the repository. Artifacts exclude credentials, headers, thinking and signatures.

Artifacts include actual model-facing contexts, calls, replies, child reports and ledgers. Review prose and spawn briefs too: structured assertions cannot prove absence of contradictory authorization in arbitrary text. Base is diagnostic and may also pass; no historical premature-closure RED or universal model reliability is claimed.

## Sequencing and limits

When routing blocks procedure reads, use existing spawn_child with an appropriate role for bounded discovery of obligations, prerequisites, sources and unresolved questions before dependent work. Explore has no Verdict. Routing stay/off does not require an extra discovery child. Any same-message child launch still releases parent tools immediately: waiting for discovery and resolving prerequisites is an orchestration contract, not enforced waiting by the gate. Parent-reserved setup, scope pause and global reconciliation remain mandatory.

The prior PR head's direct-read evaluation is historical evidence for a replaced design, not current validation. The baseline also paused/blocked in that evaluation. Current commands/results are recorded separately after implementation. This evaluation covers explicit blockers, not successful isolated setup, resolved-scope continuation, real technical passes, original private consumer artifacts, actual child models, or statistical reliability. Mutation testing is unsupported by repository policy.

## Redesign validation record

- Deterministic RED against the prior PR candidate: `node --test test/delegation-gate.test.mjs` had 40 pass / 5 fail (ordinary leave reads, unrelated-tool branch lookup, real parent reads and revised routing explanation). After deleting the exemption: 45 pass / 0 fail. `node --test test/delegation-mode.test.mjs` had 23 pass / 2 fail for the new model-facing discovery contract, then 25 pass / 0 fail. `node --test test/parent-obligations-live.test.mjs` rejected the newly permitted explicitly blocked unowned ledger before the oracle change; afterward 2 deterministic tests pass and 3 opt-in scenarios skip.
- `node --test test/child-sessions.test.mjs`: 221 pass / 4 skip / 0 fail. Real child reads include skill, referenced scope and missing instruction; delivered handoffs preserve sources, prerequisites, unknown scope and the missing-path blocker. These controlled-provider transport assertions characterize unchanged transport, not historical model failure.
- `npm run check`: 1041 pass / 17 skip / 0 fail; typecheck, lint, package/release and packed-distribution checks passed. The 17 skips include the 3 separately executed live scenarios. Existing lint warnings remain unrelated to this redesign.
- `PI_WORKFLOW_PARENT_LIVE=1 PI_WORKFLOW_PARENT_ARTIFACTS=/tmp/277-redesign-evaluation-final node --test test/parent-obligations-live.test.mjs`: 5 pass / 0 fail (2 oracle tests plus 3 actual-parent comparisons), 163.4 seconds. Candidate scenarios used 6/5/5 requests and 1/1/2 children. Every candidate actually attempted a direct read, received a routing block, received controlled discovery and recorded all five obligations globally blocked; scope reply chose pause with `SCOPE-277` and missing setup. Final briefs, replies and prose were inspected: inventory-only, no dependent authorization or fabricated passes. Base also passed all three; this is not historical behavioral RED.

Sanitized six-run evidence is `/tmp/277-redesign-evaluation-final/{base,candidate}-{scope-question,done-one,done-many}.json`; command outputs are `/tmp/277-redesign-{check,live-final}.log`. These are run artifacts, not the authority for the pre-test coverage table. One earlier run failed before inference because the evaluator confused SDK registry/runtime method names; another incorrectly searched only downstream tool-call handlers for blocked calls. The corrected check observes actual assistant calls and tool results, since the routing gate short-circuits later handlers. Neither instrumentation failure is evidence of incorrect parent decisions.

ADR 0018 records the redesign in the same introducing PR; no accepted ADR is edited.


## TEST-3 / TEST-4 follow-up validation

Coverage is limited to the accepted evaluator fixes: closed ledger identities/owners at the disposition oracle and observable action choice at the existing controlled-child execution boundary. Expected cases derive from the accepted TEST-3 critique and the Owner-selected TEST-4 action interface, not model output. Tested: decorated-owner pending; duplicate identities in both orders; unknown/missing identities; unowned blocked with/without reason; all three owned-pending values; dependent authorization under unresolved scope/setup; valid discovery; invalid/absent action. There is no no-seam waiver.

- Safety net before edits: `node --test test/parent-obligations-live.test.mjs`: 2 pass / 3 skip / 0 fail.
- TEST-3 old-oracle RED: `node --test --test-name-pattern='obligation identities' test/parent-obligations-live.test.mjs`: 0 pass / 4 fail (decorated-owner pending, duplicate-first, duplicate-last, unknown). GREEN: `node --test test/parent-obligations-live.test.mjs`: 6 pass / 3 skip / 0 fail after the closed-owner/identity fix.
- TEST-4 old-execution RED: `node --test --test-name-pattern='fixture dependent' test/parent-obligations-live.test.mjs`: 0 pass / 1 fail. The same fake-child execution body ignored the task, performed discovery, and produced no evaluation error for dependent authorization. GREEN: `node --test test/parent-obligations-live.test.mjs`: 8 pass / 3 skip / 0 fail with action controlling execution and shared action errors included in actual evaluation.
- Fresh actual-model comparison: `PI_WORKFLOW_PARENT_LIVE=1 PI_WORKFLOW_PARENT_ARTIFACTS=/tmp/277-test34-live-20261016 node --test test/parent-obligations-live.test.mjs`: 11 pass / 0 skip / 0 fail, 153.3 seconds. Model `openai-codex/gpt-6-astra`, medium thinking, cached catalog and in-memory configured authentication; opportunistic delegation with controlled Jev leave routing; baseline `66eb1832910dbe902d98e889cf2d64e2b49809cf`. Candidate requests: 6/5/5; children: 1/1/2. Baseline requests: 6/5/7; children: 1/1/2.
- Fresh six traces: `/tmp/277-test34-live-20261016/{base,candidate}-{scope-question,done-one,done-many}.json`; output: `/tmp/277-test34-live.log`. All selected discovery, both scope replies selected pause, and all ledgers were globally blocked with five obligations. Generated briefs, replies, intermediate and final prose were inspected: inventory-only briefs; no contradictory dependent authorization, invented setup or fabricated technical passes observed. Both baseline and candidate passed; this is not a historical behavioral RED.
- `npm run check`: 1047 pass / 17 skip / 0 fail; complete gate including typecheck, lint, package/release and packed distribution passed in 18.8 seconds. Four existing lint warnings remain. No transient `ENOTEMPTY` agent/pids cleanup failure recurred. Output: `/tmp/277-test34-check.log`. `git diff --check` passed.
- Deterministic evidence logs: `/tmp/277-test3-{red,green}.log` and `/tmp/277-test4-{red,green}.log`. Earlier traces above predate this action protocol and do not validate the changed protocol.

The action interface observes an explicit fixture decision, not semantic interpretation of free prose or execution by real child models. Existing containment, injected candidate contracts, actual parent transport, blocked ordinary read and one/multiple-child coverage remain intact. No production or ADR changes are part of this follow-up. Parent independent confirmation/review and signed delivery remain separate.
