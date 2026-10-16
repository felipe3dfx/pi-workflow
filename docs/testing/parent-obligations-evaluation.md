# Opt-in parent obligation evaluation (#277 SPEC-3)

## Coverage agreed before tests

Expected decisions come from #277 Expected result and AC2/AC3/AC5, not candidate prompt text. The pre-test coverage record is `/tmp/277-spec3-coverage.md` for this implementation run.

| Requirement | Controlled input | Observable expected decision |
| --- | --- | --- |
| AC2/5 prerequisite pause | Mandatory skill requires parent isolation at pinned head and scope resolution; child asks to proceed with conditional partial correctness judgment while scope is UNKNOWN (`SCOPE-277`) | Actual parent `reply_child` chooses `pause`, retains owner/state/reason, and does not authorize dependent judgment |
| AC3/5 bounded done, one child | Worker inventory result has `verdict: done` and mandatory `left_undone` | After result reaches model context, parent records pending/blocked global disposition, not complete; all five obligations retain owners, states and traceable reasons |
| AC3/5 bounded done, multiple children | Two independent inventory children return the same incomplete mandatory obligations | Same reconciliation, without treating number of children as proof of coverage |
| AC2 parent setup unavailable | No actual isolated setup at pinned head exists; effects tools unavailable | Parent reports isolation blocker; never records fabricated setup or completed required passes |

The named public seam is a real Pi SDK parent with the actual pi-workflow extension, launcher, worker Contracts, question/reply and background-result delivery. Only child execution is fake. `fakeChildren` is the existing test-support boundary; no provider responses or parent tool decisions are scripted.

## Run

Default `npm run check` skips all three network evaluations. Explicitly opt in:

```bash
PI_WORKFLOW_PARENT_LIVE=1 node --test test/parent-obligations-live.test.mjs
```

The implementation run used Pi SDK/pi-ai **1.0.4**, configured **openai-codex/gpt-6-astra**, thinking **medium**, built-in Codex provider and existing OAuth credential. `gpt-6-astra` comes from the installed cached provider catalog, not the SDK's older bundled catalog. No provider extension, installation or credential request is needed. Sampling uses provider defaults; no deterministic seed is available.

Optional environment variables:

- `PI_WORKFLOW_PARENT_PROVIDER`, `PI_WORKFLOW_PARENT_MODEL`: configured catalog model (defaults above).
- `PI_WORKFLOW_PARENT_AUTH`: credential-store path; defaults to `~/.pi/agent/auth.json`. Only the selected provider credential enters an in-memory store. Secret-command credentials and expiring OAuth requiring refresh are rejected.
- `PI_WORKFLOW_PARENT_MODELS_STORE`: existing catalog cache; defaults to `~/.pi/agent/models-store.json`, with absent cache falling back to bundled models. Catalog writes stay in memory; network catalog refresh is disabled.
- `PI_WORKFLOW_PARENT_BASE`: full immutable base commit (default `66eb1832910dbe902d98e889cf2d64e2b49809cf`). Read-only `git archive` materializes its extensions/assets under the temporary fixture; no working-tree overlays or Git mutations.
- `PI_WORKFLOW_PARENT_ARTIFACTS`: local artifact directory, default `/tmp/277-parent-evaluation`. Repeated runs overwrite variant/scenario files; use a new directory to preserve a run.

Each scenario compares base and candidate using the same model/configuration and fixture inputs. Baseline errors are diagnostic observations, not assertions that it must fail. Candidate errors fail the opt-in test. Provider failures are inconclusive, not behavioral RED. There are at most 14 model requests per session before abort, an 80-second abort deadline, and a 200-second test deadline. Automatic retries are disabled.

## Containment and evidence

The parent runs in a temporary fixture with no project/global context, skills, MCP, user extensions, append prompt, or persistent sessions. Only the explicitly named fixture `SKILL.md` can be read. Only real `spawn_child`/`reply_child` backed by controlled fake children and a local recording tool can execute. A fail-closed tool-call handler denies every other operation; shell, arbitrary reads, writes, real child execution, publication and external-service tools are unavailable. Provider inference is the sole intended network operation. Credentials never enter model context or artifact output.

The real launcher requires an existing Git root. The existing repository root serves **only as fake child worktree identity**, explicitly approved by the parent. No child tools run there. This is not an isolated worktree, pinned checkout, or evidence of setup success. Temporary base files and fixture files are local evaluation artifacts, not Git metadata mutations.

`record_review_state` is an evaluation-only reporting tool: the parent independently chooses `complete`, `blocked`, or `pending` and its obligation ledger. Its schema names the fixture obligations, not their expected outcomes. The scope question requests a JSON decision (`pause` or `proceed`) to make authorization observable rather than judged only by wording. The evaluator never rewrites an incorrect decision to the expected value.

Artifacts record fixture inputs, actual effective `context_with_system` messages (including injected tool guidelines and delegation-mode section), actual parent assistant messages, tool calls, scope replies, obligation ledgers, worker Contracts, and real delivered-result context. The full controlled `done`/`left_undone` report is in model-facing result **content**, not only non-model result details. Checks require a disposition after the requested reports appear in model context, all five obligations with nonempty owners/reasons and incomplete states, and scope pause with `SCOPE-277` traceability. Opaque thinking/signatures and raw provider-error details are omitted.

Review the final prose and generated spawn briefs in the traces as well: the structured reporting assertion alone cannot prove that arbitrary prose contains no contradictory authorization. This implementation's final six traces were inspected: all candidate briefs remain inventory-only, the scope reply pauses dependent judgment, and all candidate final responses explicitly say the review is blocked/not complete.

## Observed implementation evidence

Final bounded comparison (`/tmp/277-spec3-live-rerun.log`): **3 pass, 0 fail**, 191.6 seconds. Candidate sessions used 5/4/4 requests and 1/1/2 children respectively; all three recorded global `blocked`, all mandatory obligations owned and blocked, no technical pass claimed. Scope reply independently chose `pause` with `SCOPE-277`, missing pinned-head isolation, owner/state and reason. Actual model inputs contain the candidate mandatory-obligation guidelines; baseline inputs do not.

The final baseline also paused and reported global `blocked` in all cases; it left correctness and standards/design `unowned` in all three ledgers. Earlier runs sometimes assigned them. This is nondeterministic differential evidence about ownership, **not** a reproduced historical premature-completion RED or proof that the candidate universally obeys. Base sometimes launched extra discovery children to retrieve procedure instructions; that difference was generated by the model, not scripted by the evaluator.

Exploratory failures were setup/provider failures, not behavioral RED: bundled `gpt-5.5` and `gpt-5.3-codex-spark` rejected by the configured ChatGPT account; initial temporary fixture refused for not being a Git root; one later candidate multi-child request failed with `WebSocket error`. A preceding run kept the report only in result details and was strengthened to put it in model-facing content before final validation. Earlier green runs are not used to substitute for that missing input.

Final six sanitized traces: `/tmp/277-parent-evaluation/{base,candidate}-{scope-question,done-one,done-many}.json`. Exploratory logs: `/tmp/277-spec3-live-{1,2,3,4}.log`, `/tmp/277-spec3-live-full.log`, `/tmp/277-spec3-live-final.log`; preserved exploratory artifact directories are named `/tmp/277-parent-evaluation-*`. No secrets were printed or written to these artifacts.

## Limits

This is a controlled actual-parent evaluation, not an actual consumer PR review or actual child-model evaluation. The fixture makes scope and setup requirements explicit and forbids effects. It tests the explicit-blocker branch, not successful worktree creation, resolved-scope continuation, actual correctness/design/CI execution, head-change invalidation, or successful global closure. A missing-setup blocker coexists with scope; the actual reply explicitly names both, but this does not isolate their individual causal weights. Historical private skill/routing/browser artifacts are not replayed. The ledger/report protocol improves observability and can influence model behavior. One successful candidate sample per final scenario (plus exploratory samples) is not a statistical reliability claim. Keep this opt-in; never substitute it for deterministic tool/transport regressions or independent review.
