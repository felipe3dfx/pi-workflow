# Advisor

Status: APPROVED (not implemented).

Package: `advisor/definition-4`, the approved brief `docs/features/advisor.md`.
Review handoff: `advisor/feature-review-3`, `docs/features/advisor-review.md`, verdict `READY WITH WARNINGS`.
Prototype: branch `prototype/advisor-card`, commit `93c0b5e87f2e43597a1cc1b0a403b6cbbc843b19`, [Approved Prototype UI Contract v1](https://github.com/felipe3dfx/pi-workflow/blob/93c0b5e87f2e43597a1cc1b0a403b6cbbc843b19/prototype/advisor-card/approved-advisor-card-v1.md), disposition `reference-only`.
Parent: #391.

## Problem

The operator of Pi with this harness has no way for the parent session to get an independent second opinion from a stronger model before committing to an approach, when stuck, or before declaring work done. Source: developer request of 2026-11-20, with `philipbrembeck/pi-advisor` as the reference.

## Solution

Add the `Advisor` harness capability (GLOSSARY "Advisor"; ADR 0030). While it is seated and a well-formed advisor model file exists, the parent session is offered one parameterless `advisor` tool. Calling it sends the advisor model the parent's latest request-time system prompt, the parent's conversation projected to text without truncation, and the advisor's fixed instructions, with no tool declarations. The Markdown answer returns as the tool result and is shown in its own advisor card in the message stream. The operator seats or unseats the capability in `/workflow:config` and chooses the global advisor model and thinking level with `/workflow:advisor`. Failures are readable, non-blocking tool errors. Child sessions never receive the tool.

## User stories

1. As the operator, I want to turn the advisor on or off in `/workflow:config`, so that it is configured with the other harness capabilities.
2. As the operator, I want to choose the advisor model and thinking level with `/workflow:advisor`, so that the advisor never silently inherits the session model.
3. As the operator, I want an existing selection file to keep working after the upgrade, so that `/workflow:config` still opens.
4. As the parent session, I want to consult the advisor without arguments, so that it sees what I see without my summarizing it.
5. As the parent session, I want guidance with the tool on when to consult, so that I call it at the moments it helps.
6. As the parent session in `orchestrator`, I want consulting the advisor to remain mine, so that the Delegation mode instruction does not forbid it.
7. As the operator, I want each consultation shown as a distinct advisor card with its model, elapsed time, and a preview, so that I can read the advice without it looking like a child conversation.
8. As the operator, I want every failure shown as a readable failed, stopped, or refused card, so that a consultation never blocks the session.
9. As the operator, I want the advisor's cost to count toward the session, so that its usage is visible where the rest is.

## Implementation decisions

Labels: **MANDATORY** decisions cite the authority that requires them (a brief decision or scenario, an ADR, the review, or an indispensable dependency). **RECOMMENDATION** decisions are structural choices supported by evidence; an implementation may choose another shape that preserves the same observable behavior and invariants. Every functional decision below comes from the brief and keeps its resolver, source, and status (see Decisions). Specification decisions SD1–SD13 resolve the brief's "Left to the specification" evidence gaps and are listed in the Decisions section.

### Capability and selection

- MANDATORY (D3c, ADR 0030, scenarios 1–2): `advisor` joins the harness capability list. With no selection file it is on, like every harness capability. A selection that names every other harness capability but not `advisor` is valid, reads `advisor` as on, and keeps every other value. A selection missing any other harness capability, holding an unknown key, or holding a non-boolean value stays refused as ADR 0009 decides. The next apply writes the `advisor` key. Reason: existing installs must not be locked out of `/workflow:config`. Evidence: `readSelection` today requires the exact key count of `capabilities`; this check changes for the advisor only.
- MANDATORY (D11, ADR 0030): the capability declares the `overlay` place (for `/workflow:advisor`) and the `message-stream` place (for its card) in the Shell place map, and `seated("advisor", …)` is valid for exactly those places.
- MANDATORY (scenario 3): the `/workflow:config` Capabilities section shows `[x] Advisor` / `[ ] Advisor`, staged, marked, counted, and applied with the rest of the plan. Its description names `/workflow:advisor` as the way to choose the model. RECOMMENDATION: the row comes last in the Capabilities section (append `advisor` after `compact-rendering`), and its copy reads in the style of the Model profiles row, for example "Lets the parent consult a second model for advice; choose it with /workflow:advisor." Evidence: the guide lists capabilities in `capabilities` order (workflow config guide specification) and `capabilityCopy` holds one label and description per capability. Reason: appending moves no existing row. Necessity: the row must sit somewhere; any position preserves the approved behavior.
- MANDATORY (ADR 0009, brief invariant): unseating starts no new work; a consultation already running finishes and returns its result.

### Advisor model file

- MANDATORY (D2b, ADR 0030): one global advisor model and thinking level, stored in its own file in the agent directory, outside the selection and outside model profiles. `/workflow:models` and model profiles do not carry it. The advisor never inherits the session model.
- MANDATORY (scenario 7, D15, brief shared capabilities): the file follows the `createDelegationMode` pattern. Any read error, parse error, or shape error reads as "no model". `/workflow:advisor` opens normally over such a file and overwrites it on the next choice with `writeJsonAtomically`, with no changed-on-disk check. Evidence: `createDelegationMode` returns its default on any failure and `set` overwrites without reading; `model-profiles` refuses instead, which is not the cited pattern (review FE2-4).
- SD1, RECOMMENDATION (GLOSSARY "Agent directory"; review FE7 left the name to the specification): the file is `pi-workflow-advisor.json`, beside `pi-workflow-selection.json` and `pi-workflow-delegation.json`. Evidence: both siblings use the `pi-workflow-` prefix and a `schemaVersion: 1` object. Reason: one naming and versioning convention in the agent directory. Necessity: D2b requires a file; its name and shape are otherwise free. Its shape:

  ```ts
  { schemaVersion: 1; model: string /* "<provider>/<id>" */; thinking: string /* Pi thinking level */ }
  ```

- SD2, MANDATORY (D15, scenario 6): well-formedness is decided from the file alone; availability in Pi and thinking support are never part of it and are checked at call time. Reason: D15 makes the offer depend only on the seat and the file, so no catalog or auth listener is needed (review C6). RECOMMENDATION, with SD1's shape: the file is well-formed when it parses as a JSON object, `schemaVersion` is `1`, `model` is a string with a non-empty provider before the first `/` and a non-empty id after it, and `thinking` is one of Pi's thinking level names; extra keys do not make it ill-formed. Evidence: `createDelegationMode` validates schema version and value the same way. Necessity: tests need one precise rule.

### `/workflow:advisor`

- MANDATORY (A1, D2b, ADR 0030 superseding ADR 0012 for this command): the command is `/workflow:advisor`. It joins the `/workflow` usage line, the package's command-surface validator, and the README command table.
- MANDATORY (existing `/workflow` command convention: every command reports the usage line on arguments; ADR 0009 argumentless commands as carried by ADR 0012): with any argument it reports the usage line and does nothing. MANDATORY (scenario 5, mirroring `/workflow:models`): with the capability unseated it reports `Advisor is disabled. Enable it in /workflow:config.` and does nothing. Without the TUI it reports a refusal and does nothing, as `/workflow:models` does. RECOMMENDATION: checks in that order, and the TUI refusal reads `The advisor picker needs the TUI.`
- MANDATORY (scenario 4, D16): the overlay lists the available models (`ctx.modelRegistry.getAvailable()`) with a type-to-filter, then the thinking levels that model supports (`getSupportedThinkingLevels`). The two screens are extracted from `model-profiles-editor` (`catalogScreen`, `thinkingScreen`) into a picker that both commands use; Pi's `ModelSelectorComponent` is not used, because it needs a `ModelRuntime` extensions do not receive (review FE2-3). `/workflow:models` behavior stays identical (R3).
- MANDATORY (D13, scenario 4): choosing the thinking level writes the advisor model file at once and closes the overlay. There is no save step and no discard prompt. Closing the overlay before a thinking level is chosen writes nothing. Esc on the thinking screen returns to the model list (OD1, under Resolved specification questions).
- MANDATORY (scenario 4, scenario 6): after the write, the tool offer is re-evaluated in the same session, so the tool is offered without a reload.
- MANDATORY (A2): choosing the session's own model is allowed; nothing compares them.

### Offer, withdrawal, and late calls

- MANDATORY (scenario 6, D15): the `advisor` tool is offered exactly when the capability is seated AND the advisor model file is well-formed. The offer is evaluated at session start, whenever seating changes (with the other offers Seating runs), and after `/workflow:advisor` saves. The file is not watched for outside edits.
- RECOMMENDATION (brief shared capabilities; evidence `offerTool`, `syncCodeGraphTool`, `createSeating`'s `offers`): offering and withdrawing reuse `offerTool` (`direct` or `hidden` exposure) and join Seating's `offers` list, as CodeGraph does. Reason: Seating already re-runs its offers at session start and on every seat change, which are two of the three evaluation points. Necessity: the highest existing seam; no new mechanism is needed.
- MANDATORY (scenario 11, review C6): a call that arrives after the tool was withdrawn still reaches `execute`, because a response's calls run against the tool set of its request. `execute` therefore checks the seat itself, and a call made while unseated returns the readable refusal (failure kind `refused`, below). Evidence: Pi refreshes the tool set only when it prepares the next request.
- MANDATORY (scenario 6, scenario 10): a call made while the file is missing or ill-formed after an outside edit returns the `no-model` failure. A call already running when the file or the seat changes finishes with the model it started with.

### Request-time capture

- MANDATORY (D8b, scenario 8; review "restricción para la spec", FE2-1): the harness captures, on each parent request, the system prompt the request carries (Pi's prompt and every section added by handlers that ran before the capture, including the Delegation mode section) and that request's message list. The capture handler registers on `context_with_system` after `registerDelegationMode`. Reason: handlers run in registration order, and a capture registered earlier misses the Delegation mode section. Residual: edits by extensions loaded after pi-workflow and by `before_provider_request` do not reach the advisor (R6). Evidence: the child runtime's capture uses the same event; Agent language is added in `before_agent_start` and is always visible to the capture.
- MANDATORY (FE2-10, D6): the captured system prompt includes the parent-facing advisor guidance (D4) and, in `orchestrator`, the keep-list item. The advisor receives them as the parent's instructions, not its own (see Fixed instructions).

### Conversation projection

SD3 resolves "the exact text projection format" and SD4 "whether the in-flight advisor call appears in the projection".

- MANDATORY (D8b, scenario 8): the harness never truncates, caps, summarizes, filters, or redacts the projection. Every tool result appears in full. Consequence: Pi's exported `serializeConversation` is not usable, because it truncates each tool result to 2,000 characters (`TOOL_RESULT_MAX_CHARS`).
- SD3, RECOMMENDATION (evidence: Pi `serializeConversation`, `convertToLlm`; pi-advisor `conversation.ts`): the projection converts the captured messages with Pi's `convertToLlm` (so compaction and branch summaries, custom harness messages, and bash executions appear as the parent's model received them) and renders them in order as labeled plain-text blocks: user text, assistant text, each tool call with its name and full JSON arguments, and each tool result with its tool name, error status, and full text. Images appear as a marker naming the image, not its data. Thinking blocks are omitted, for Pi's documented reason: providers return summaries of the real reasoning and replayed thinking is often not part of the live context. Labels follow Pi's `[User]` / `[Assistant]` style and never use the GLOSSARY "Advisor" _Avoid_ terms (executor, reviewer, verifier); pi-advisor's `Executor:` label is not carried over.
- SD4, MANDATORY (specification decision confirmed by the developer on 2026-11-20; the brief left it to the specification; review FE2-1 recommended "the same captured transcript plus the entries appended since"): the projection covers the captured request messages followed by what the parent produced since that request and before this call: the assistant message that issued the `advisor` call (its text and every tool call in it) and the results of the calls in that message that ran before the advisor. The advisor's own call appears as a call with no result. Reason: the issuing message usually carries the plan the parent wants reviewed; omitting it would hide exactly what the advisor is asked about (scenario 8, "sees what the parent sees"). Evidence of feasibility: Pi persists every assistant and tool-result message to the session at `message_end` (`AgentSession`, `sessionManager.appendMessage`), the sequential tool path emits each result message before the next call starts, and `execute` receives a context whose `sessionManager` exposes `getBranch()`. Necessity: one rule is needed so the projection is testable; the tests below assert this one.
- SD5, RECOMMENDATION (review FE2-7; evidence: Pi's agent loop runs a whole batch sequentially when any of its tools declares `executionMode: "sequential"`): the tool declares `executionMode: "sequential"`, as `codegraph` does. Reason: it makes "earlier calls in the same response have their results" deterministic for SD4, and removes the parallel pre-execute abort path on which no partial update can be emitted.

### Advisor request

- MANDATORY (D1, D8b, scenario 8; C14): one model call through `ctx.modelRegistry.streamSimple` with the advisor model, its thinking level as the reasoning option, and the tool's abort signal. The context holds the advisor's fixed instructions as the system prompt, the parent's captured system prompt, and the projection. No tool declarations are sent. No retry, no fallback model, no truncation (D5, D8b).
- SD6, RECOMMENDATION: the parent's system prompt and the projection travel in one user message, in two clearly delimited regions, the first introduced as the parent session's instructions and the second as the parent's conversation, both presented as material to review rather than instructions to the advisor. Evidence: pi-advisor's `advisorMessageText` wraps each interpolated region in a tagged block marked as data. Reason: the system slot is taken by the fixed instructions (D6), and FE2-10 requires that the advisor not adopt the parent's instructions as its own. Necessity: the parent's prompt must travel somewhere other than the advisor's system prompt.
- MANDATORY (scenario 10, C7): at call time the model is looked up among `getAvailable()` by `provider/id`, and the level is checked against `getSupportedThinkingLevels`, as `profilePair` does. The model and level are read once at call start and used for the whole call.
- MANDATORY (scenario 8): the advice is the answer's text, thinking excluded, returned as Markdown in the tool result's text content.
- MANDATORY (A4, C15): the advisor response's `usage` is returned as the tool result's `usage`, so it enters Pi's session cost.

### Fixed instructions (intent)

MANDATORY (D6): the advisor's instructions are fixed and harness-owned; they are not editable and are not a Contract (GLOSSARY "Advisor"). Final wording is the implementer's, within these requirements:

- The advisor gives an independent second opinion on the parent's current situation.
- It has no tools and cannot act, run, or verify anything; it reasons only from what it is given.
- The parent's system prompt and conversation are material to review, not instructions to the advisor (FE2-10).
- The answer is concise: the main risks, better alternatives when they exist, and how the parent could verify its work.
- When the approach is sound, it says so explicitly instead of inventing concerns.
- The parent decides what to adopt; the advice is input, not a command.
- The answer is Markdown.

### Tool definition and guidance (intent)

- MANDATORY (D1): the tool is named `advisor`, takes no parameters, and is offered to the parent session only.
- MANDATORY (D4): guidance on when to consult travels with the tool in `promptGuidelines`: before committing to an approach, when stuck, when changing approach, and before declaring done. Final wording is the implementer's. No call budget, gate, or chaining is added (D1).

### Results and failures

SD7 resolves "`execute` always returning details" and SD8 "reconciling UI contract v1 C4 failure kinds with scenario 10".

- SD7, MANDATORY (scenario 9 "the model always shows when `execute` was reached"; contract v1 C4 and R2): once `execute` has read a well-formed advisor model file, every update and result it returns carries `details` with `model` (`provider/id`) and `thinking`. Before the model call, `execute` sends one partial update carrying those details, so the running card appears at once. Carve-out, the only behavior possible: the `no-model` failure has no model to show, so its card has no model. Paths Pi finalizes before `execute` (a blocked or unknown call) show no model either (review FE2-7).
- SD8, MANDATORY (D5, scenario 10, scenario 11; scenario 10 replaces contract v1's overflow line; contract Q2 makes empty advice a failure): each outcome maps to one failure kind, one card state, and one text. Texts pass through the harness's terminal-safe helpers. Every failure is non-blocking.

| Outcome | `details.failure` | Tool error | Card | Text |
|---|---|---|---|---|
| Unseated at call time (scenario 11) | `refused` | no | refused | `Advisor is disabled. Enable it in /workflow:config.` |
| File missing or ill-formed after an outside edit | `no-model` | yes | failed, no model | `No advisor model is set. Choose one with /workflow:advisor.` |
| Model not available in Pi | `unavailable` | yes | failed | `The advisor model <provider/id> is not available in Pi. Choose another with /workflow:advisor.` |
| Thinking level not supported | `thinking` | yes | failed | `The advisor model <provider/id> does not support thinking <level>. Choose another level with /workflow:advisor.` |
| Provider failure recognized as context overflow | `overflow` | yes | failed | The provider's message, then `Choose a larger advisor model with /workflow:advisor.` No token counts. |
| Any other provider or auth failure | `provider` | yes | failed | The provider's message, verbatim |
| Answer with no text after trimming | `empty` | yes | failed | `The advisor returned no advice.` |
| Operator abort (Esc) | `aborted` | yes | stopped | `Advisor consultation stopped by the operator.` |

- MANDATORY (D8b, scenario 10): overflow is never detected ahead of the call. It is recognized only from the failed response, with Pi's `isContextOverflow(response, advisorModel.contextWindow)`. An overflow the function does not recognize is a `provider` failure; silent provider truncation is undetected (R7).
- SD13, RECOMMENDATION (scenarios 9–11): `execute` reads the file first and then checks the seat. An unseated call is refused even when the file is broken; when the file is well-formed, the refused card still shows the model (SD7). Reason: scenario 11 makes a withdrawn tool refuse, and scenario 9 shows the model whenever `execute` was reached. Necessity: one order is needed for the case where both checks fail.

### Advisor card

MANDATORY (D10, scenario 9): the card's observable behavior follows approved UI contract v1 (header H1–H7, states S0, S1, S3–S5, S7–S10, family F1–F2, hostile input), with these changes recorded by the brief: S6 (done, empty) is replaced by the `empty` failure; the overflow failure text is replaced as in SD8; S9 covers only the scenario 11 refusal; "the model always shows" is scoped by SD7. In summary:

- Header `◇ Advisor[ <state word>]  <elapsed> · <model> (<thinking>)` with the expand hint at the right when it fits. `◇` is cyan while running, accent when done, error when failed, dim when stopped or refused. State words: `consulting…`, none, `failed`, `stopped`, `refused`. Elapsed is absent while running. The model always shows, collapsed too, without its first provider segment. Narrow widths drop the hint, then shorten the model id with a middle `…` (minimum 10 columns, keeping ` (thinking)`), then truncate.
- Done: the first 3 rendered Markdown lines and a dim `… N more lines`; advice of 4 or fewer rendered lines shows whole with no hint. It expands with Pi's tool expand key, a click on the header, or the transcript cursor; it collapses the same way.
- Failed: the reason in error color under the header, always visible. Stopped and refused: their dim text.
- Model, thinking, and advice are made terminal-safe. Every line fits its width.
- MANDATORY (D10, contract F3): the transcript cursor and hover marker recognize the `◇` glyph (`chrome-groups` `pointAt`), so cursor navigation marks advisor cards as it marks `◆` and `◈` heads.
- SD9, MANDATORY (contract P1, D11): the card paints rich only while `advisor` is seated in the message stream; unseated, past cards fall back to plain text with the glyph removed (contract S10). Child cards keep their own `child-session` seat and behavior unchanged.
- SD10, RECOMMENDATION (brief shared capabilities; review C18, FE2-8): build the card from the child-result card family's frame, body, and fallback helpers, parameterized by seat and by the glyph the plain fallback strips, instead of copying them. Reason: one visual language for the family (ADR 0009, Shell owns visual language) and locality for its fixes. Necessity: today those helpers hard-code the `child-session` seat and the `◆` glyph. Subagent and Parent cards must render byte-identically after the change.
- Not required (review SP2-2): contract S2 (a partial without details) and the missing-details invalid paths (states 18 and 19). SD7 makes this `execute` never produce them; a defensive render is allowed but needs no dedicated test.
- RECOMMENDATION (contract C0–C4, mechanism, `reference-only`; evidence: the prototype rendered every state with these mechanisms in the real Pi host; reason: they reuse Pi's row expansion, click, and cursor instead of adding card state; necessity: none beyond the observable behavior above): `renderShell: "self"`, a hidden `renderCall`, Pi's per-row tool expansion rather than a card-owned map, elapsed from Pi's `durationMs`, and model and thinking also kept from the partial in render state.

### Delegation mode

- MANDATORY (scenario 12, ADR 0015 as amended by ADR 0030, GLOSSARY "Delegation mode"): while the advisor tool is offered, the `orchestrator` instruction lists consulting the advisor among what the parent keeps. When the tool is not offered, the instruction is unchanged. RECOMMENDATION: `registerDelegationMode` receives an "advisor offered" predicate, as it receives `childToolsOffered`; the item reads like the `todo` and operator-question items.

### Child sessions

- MANDATORY (scenario 13; out of scope "an advisor in child sessions"): child sessions never receive the `advisor` tool, in any host. Evidence: children run without the workflow extension and receive only the child runtime's tools.

### Action authorization

- MANDATORY (D14, scenario 14, ADR 0025 as amended by ADR 0030): the `advisor` tool is a harness message. Its definition carries the harness-message marker and joins the exemption map by name and exact parameters schema object, like `reply_child` and `ask_user_question`. In the contextual host each call is not classified and delivers a `kind: "exempt"` audit decision with its tool and input. No other tool's treatment changes. Reason: ADR 0030 records why the egress to the advisor's provider does not need classification. Residuals: R1, R4.

### Structure of the code

- SD11, RECOMMENDATION (codebase-design: deep module, small interface): one advisor module owns the model file, the offer rule, the request-time capture, the projection, the model call, and the failure mapping. Its interface toward `piWorkflowExtension` is small: register it (after `registerDelegationMode`), add its offer to Seating's `offers`, read whether it is offered (for Delegation mode), and run its command. The model call's seam is the existing `ctx.modelRegistry` interface, which tests satisfy with a faux provider or a local endpoint; no new adapter seam is introduced, because only one adapter exists. Evidence: `piWorkflowExtension` already composes CodeGraph, todo, and operator questions the same way. Reason: the deletion test holds; removing the module would spread file, offer, capture, and failure rules across the extension entry point, the command, and the card. Necessity: locality for R6 and R7 fixes and one test surface for the consultation.
- SD12, RECOMMENDATION (D16, R3): the extracted picker is a module whose interface takes the catalog, the supported levels, the theme, the keybindings, and a choice callback, and holds no profile or advisor state. Both commands are its adapters; `/workflow:models` keeps its stack, save, and discard behavior around it. Evidence: `catalogScreen` and `thinkingScreen` capture only the catalog, levels, theme, keybindings, the editor's screen stack, and module-local list helpers (review C1). Reason: two callers make the seam real. Necessity: D16 requires sharing; keeping profile state out is what keeps `/workflow:models` identical.

## Testing decisions

Tests follow `node --test test/*.test.mjs` and the shared helpers in `test/support/README.md`; check that table before writing a helper. Each test observes behavior through a public seam: rendered lines, files on disk, registered tools and their exposure, requests the model endpoint receives, and tool results. `npm run check` is the quality gate.

- Seam, selection and Configure: `readSelection` and the `/workflow:config` handler driven with `driveConfig` and the config-guide helpers, plus `selectionWith`. Cases: absent file reads `advisor` on; a selection without `advisor` opens, reads it on, and keeps every other value; a selection missing another capability, with an unknown key, or with a non-boolean `advisor` is still refused; the `Advisor` row, its `[x]`/`[ ]` toggle and pending marker, its description naming `/workflow:advisor`; applying writes the `advisor` key and seats or unseats it.
- Seam, `/workflow:advisor`: the command handler on a fake parent (`parentSession`, `seat`) with a fake `ctx.ui.custom`, in an agent directory from `withAgentDirectory`, using the theme prior art of the model-profiles editor tests. Cases: arguments, unseated, and no-TUI refusals with their texts and no file written; the model list with filtering; the thinking levels of the chosen model; choosing a level writes the well-formed file and offers the tool in the same session; closing before a level writes nothing; an ill-formed or unreadable file opens the picker and is overwritten; every rendered line fits its width.
- Regression guard, `/workflow:models` (R3): the existing model-profiles editor and command tests pass unchanged.
- Seam, offer: the fake parent's registered `tools` and their exposure across session start, seating changes, and saves. Cases: seated without a file, not offered; seated with a well-formed file, offered; ill-formed file, not offered; unseated, withdrawn; an outside edit does not change the offer until the next evaluation.
- Seam, consultation: a real parent session (`realParent`) whose advisor model is served by `modelEndpoint` (or the faux provider), recording each request body. Cases: the advisor request has the fixed instructions as system prompt, carries the parent's request-time system prompt including the `orchestrator` Delegation mode section, and declares no tools; a tool result longer than 2,000 characters appears whole; the compaction summary, earlier tool calls with arguments, and the issuing assistant message's text appear, and the advisor's own call appears without a result; the advice returns as the tool result with `details` model and thinking and with the advisor's `usage`. Failure cases, one per SD8 row: refusal after unseating with `isError` false; file removed by an outside edit; model not available; thinking not supported; provider error; a context-overflow failure carrying the hint and no token counts; empty answer; abort while running. `modelEndpoint` always answers with status 200 today, so it must be extended to script an error and an overflow response (or the faux provider used for them), with its `test/support/README.md` row updated.
- Seam, card: the tool's result renderer hosted as Pi hosts it, as the child-result card and chrome-groups tests do. Cases: running header with model before any advice; done collapsed preview with `… N more lines`; short advice with no hint; expanded Markdown; failed, stopped, and refused states with their texts; `no-model` failure with no model; narrow-width shortening and every line within width; hostile model id and advice neutralized; the cursor and hover marker on a `◇` head; plain fallback with the glyph removed when `advisor` is unseated; Subagent and Parent cards unchanged.
- Seam, Delegation mode: the parent system prompt in `orchestrator` includes the advisor item exactly while the tool is offered.
- Seam, children: the tool lists a child receives (`workerTools`, `spawnedTools`) never include `advisor`.
- Seam, contextual host: an `advisor` call is not classified and delivers a `kind: "exempt"` audit decision; a same-name tool with another schema object is not exempt.
- Seam, package surface: the command-surface validator requires `workflow:advisor`, and the usage line lists it.
- Mutation testing is unsupported in this repository (`docs/agents/quality.md`).

## Shared-capability invariants

For implementation and ticket slicing:

- `/workflow:models` behaves identically after the picker extraction; the picker holds no profile state (D16, R3).
- Subagent and Parent cards render identically after the card helpers are parameterized; their seat stays `child-session` (SD9, SD10).
- `pointAt` keeps marking `◆` and `◈` heads; it only gains `◇` (D10).
- `readSelection` tolerance covers the advisor alone; every other refusal reason is unchanged (ADR 0030; SP3 rejected).
- The selection format, `planApply`, seating, setup, MCP alignment, and default settings keep their semantics; the advisor row is one more capability toggle (ADR 0009).
- The offer depends only on the seat and the file; no catalog, auth, or file watcher is added (D15; review SP3-1).
- Unseating starts no new work; an accepted call finishes (ADR 0009).
- The ADR 0025 exempt list gains only `advisor`; every other tool stays classified (ADR 0030).
- The `orchestrator` instruction is unchanged while the tool is not offered (ADR 0015 as amended).
- Children receive no new tool (scenario 13).
- The capture registers after `registerDelegationMode`; its position is load-bearing (FE2-1).

## Out of scope

From the brief: automatic gates (plan, failure, completion, loop), call budgets, follow-up chaining, outcome ledger, fallback model, Jev or scout classifiers, git or file attachments, secret redaction, editable advisor instructions, an advisor in child sessions, chat-driven configuration, a bundled skill (D9), a `/workflow:status` line (D12), any change to `/workflow:models` or model profiles, and a capability-tolerance rule for any capability other than the advisor. Also out: detecting overflow before the call (D8b), detecting silent provider truncation (R7), and a dedicated running timer in the card (contract H4).

## Prototype decisions

- Disposition `reference-only` (confirmed by the developer on 2026-11-20). Prototype code (`advisor-card.ts`, `render.mts`) is evidence, not a base to copy.
- Adopted as observable behavior through D10 and scenario 9: header, states, family distinction, expansion, cursor recognition (F3), seat P1, and invalid paths.
- Superseded by the brief: the overflow failure text with token counts (scenario 10); S6 as a done card (contract answer Q2, scenario 9: empty advice is the `empty` failure); C4's failure enum (reconciled in SD8 with `no-model` and `empty`); "the model always shows" (scoped by SD7); open question Q6 (decided by D14).
- Contract answers Q1 (3-line preview), Q3 (abort reported by `execute`), Q4 (accent done glyph), and Q5 (model always shows) stand.
- The prototype's `knip` deviation does not apply: no prototype file is shipped.

## Approved deviations

- D3c: `readSelection` tolerates a missing `advisor` key, against the no-backward-compatibility principle and ADR 0009's invalid-selection clause. Accepted by the developer on 2026-11-20; recorded in ADR 0030 and the ADR 0009 Status note.
- `/workflow:advisor` is a command outside `/workflow:config`, following the `/workflow:models` precedent; recorded in ADR 0030 and the ADR 0012 Status note.
- D14: the advisor joins ADR 0025's closed exempt list although it reaches an external service; recorded in ADR 0030 and the ADR 0025 Status note.
- Scenario 12: ADR 0015's `orchestrator` keep-list gains consulting the advisor while it is offered; recorded in ADR 0030 and the ADR 0015 Status note.
- Contract v1's overflow line is replaced by scenario 10's provider-recognized overflow without token counts (review C16).

## Accepted risks

Disposition of R1–R7: `risk accepted` by the developer on 2026-11-20 (critique NC10, FE2-1 and FE3-2), reason: accepted trade-offs of a minimal advisor; source: conversation 2026-11-20.

- R1: the full parent context, including tool results, goes to the advisor's provider, which may differ from the parent's.
- R2: each call adds cost and latency; with no budget, the model alone decides how often to call.
- R3: changing the model picker could regress `/workflow:models`. Mitigation: the regression guard in Testing decisions.
- R4: a virtual or bridged advisor model (for example `claude-bridge`) may run its own tools, contradicting "the advisor has no tools".
- R5: global `ctrl+o` expands every tool row, so long advice expands with them.
- R6: system prompt edits by extensions loaded after pi-workflow, or by `before_provider_request`, do not reach the advisor.
- R7: a provider may truncate the context silently (for example Ollama), and nothing detects it.

## Dependencies and native relationships

- `domain-modeling`, resolved 2026-11-20: GLOSSARY "Advisor", "Harness capability", "Delegation mode", and "Agent directory"; ADR 0030 superseding ADR 0009 (invalid-selection clause, advisor only) and ADR 0012 (entrypoint, advisor model only), and amending ADR 0025 and ADR 0015, each with a Status note. The advisor's fixed instructions are not a Contract. No separate Domain Authority Handoff exists; domain authority is `GLOSSARY.md` (`present (root-selected)`), an admissible evidence gap.
- Pi 1.5 (installed `@earendil-works/pi-coding-agent` 1.5.0): `modelRegistry.streamSimple` with model, reasoning, abort signal, and usage; `context_with_system`; `convertToLlm`; `isContextOverflow`; tool `executionMode`, `renderShell`, `promptGuidelines`, and `exposure` (review C13–C16, C20).
- The contextual host (`contextualWorkflowSources`) is where D14 has effect; its production adoption remains with #293 (ADR 0025 Status). The standard Pi parent has no authorization layer, so D14 changes nothing there.
- Prototype branch `prototype/advisor-card` at `93c0b5e87f2e43597a1cc1b0a403b6cbbc843b19`, UI contract v1, `reference-only`.
- Internal ordering for slicing: the capability and file precede the offer; the offer precedes the consultation; the picker extraction precedes `/workflow:advisor`; the card helper parameterization and `pointAt` precede the card. The Delegation mode item and the authorization exemption depend only on the offer.
- Tracker parent: #391; no other native relationship is recorded.

## Decisions

Functional decisions from the brief, preserved:

| # | Decision | Resolver | Source | Status |
|---|---|---|---|---|
| D1 | A parameterless tool for the parent only; forwards the session context; the advisor has no tools; no gates or budgets | developer | conversation 2026-11-20 | accepted |
| D2 | Advisor entry in each model profile, no session-model fallback | developer | conversation 2026-11-20 | superseded by D2b |
| D2b | One global advisor model and thinking level, chosen with `/workflow:advisor` and stored in its own agent-directory file; never inherits the session model; `/workflow:models` unchanged | developer | conversation 2026-11-20 (replaces D2 to keep model profiles untouched; a config-guide picker was rejected because it amends ADR 0009 and the UI contract v4) | accepted |
| D3 | `advisor` is a harness capability, on by default; old selections refused | developer | conversation 2026-11-20 | superseded by D3b |
| D3b | Same capability, on by default for a fresh selection; a selection missing `advisor` reads as off | developer | conversation 2026-11-20; ADR 0009 and the config-guide brief scenario 12 keep `/workflow:config` closed on an invalid selection | superseded by D3c |
| D3c | A selection missing `advisor` reads as on; behavior is unchanged because the tool needs a model | developer | critique SP2, 2026-11-20 | accepted |
| D4 | Guidance on when to consult travels with the tool (`promptGuidelines`): before committing to an approach, when stuck, when changing approach, before declaring done | developer | conversation 2026-11-20; `codegraph-tool.ts`; pi-advisor `src/tools/prompts.ts` | accepted |
| D5 | Failures return a readable tool error; no retry or fallback; never blocking | developer | conversation 2026-11-20 | accepted |
| D6 | Advisor instructions are fixed, harness-owned: independent review, no tools, concise risks, alternatives and verification, explicit when the approach is sound; the parent decides what to adopt | developer | conversation 2026-11-20; pi-advisor `ADVISOR_SYSTEM` | accepted |
| D7 | Advisor depends on `model-profiles` | developer | conversation 2026-11-20 | withdrawn by D2b |
| D8 | Context is the parent's current context; overflow is an error, never truncation | developer | conversation 2026-11-20 | accepted; refined by D8b |
| D8b | Context is a text projection without truncation plus the request-time system prompt (scenario 8); overflow is a provider error, not detected ahead of the call | developer | critique FE1 and SP5, 2026-11-20; Claude Code `advisor_20260301` is Anthropic-only with encrypted advice; pi-advisor projects to capped text | accepted |
| D9 | No bundled skill | developer | conversation 2026-11-20; pi-advisor `skills/pi-advisor-flow` is a configuration help guide; GLOSSARY "Engineering skills" | accepted |
| D10 | The advisor has its own card in the message stream, per approved UI contract v1, including the `chrome-groups` `pointAt` change for `◇` | developer | conversation 2026-11-20; prototype `93c0b5e` | accepted |
| D11 | The capability declares the `overlay` and `message-stream` places | developer | critique FE3, 2026-11-20 | accepted |
| D12 | No `/workflow:status` line | developer | critique SP4, 2026-11-20 | accepted |
| D13 | Choosing the thinking level saves at once; no save step or discard prompt | developer | critique SP7, 2026-11-20 | accepted |
| D14 | The advisor tool is a harness message exempt from action authorization | developer | critique NC2-2 and FE2-6 (Q6), 2026-11-20; ADR 0025 as amended by ADR 0030 | accepted |
| D15 | A valid advisor model is a well-formed file; availability and thinking are checked at call time | developer | critique FE2-5 and SP2-4, 2026-11-20 | accepted |
| D16 | The picker is extracted from `model-profiles-editor.ts`; Pi's `ModelSelectorComponent` is not used | developer | critique FE2-3, 2026-11-20 (it needs a `ModelRuntime` extensions do not receive) | accepted; replaces SP6's open choice |

Assumptions, preserved: A1 the command is `/workflow:advisor` and joins the usage line (developer, 2026-11-20); A2 an advisor model equal to the session model is allowed (developer, 2026-11-20); A3 UI text stays in English (repository convention); A4 the advisor's usage enters the session cost through the tool result's `usage` (critique C15).

Specification decisions added during synthesis (no functional change; resolver: `to-spec`, source: brief "Evidence gaps" and the review's notes for the specification):

| # | Decision | Label | Resolves |
|---|---|---|---|
| SD1 | File `pi-workflow-advisor.json`, `{ schemaVersion: 1, model, thinking }` | RECOMMENDATION | FE7 (file name) |
| SD2 | Well-formedness from the file alone (MANDATORY, D15); exact field rules (RECOMMENDATION, with SD1) | MANDATORY / RECOMMENDATION | D15 |
| SD3 | Labeled text projection via `convertToLlm`, thinking omitted, image markers, no `_Avoid_` labels | RECOMMENDATION | exact projection format |
| SD4 | Projection includes the issuing assistant message and earlier batch results; the advisor's own call has no result | MANDATORY (developer confirmed 2026-11-20) | in-flight call in the projection (NC2-7) |
| SD5 | `executionMode: "sequential"` | RECOMMENDATION | FE2-7, SD4 determinism |
| SD6 | Parent prompt and projection as delimited review material in one user message | RECOMMENDATION | captured prompt carries the parent's advisor guidance (FE2-10) |
| SD7 | `details` with model and thinking on every update and result after a well-formed read; one partial before the call; `no-model` carve-out | MANDATORY (scenario 9, contract C4) | `execute` always returning details (FE2-7, SP2-2) |
| SD8 | Failure kinds, card states, and texts table | MANDATORY (D5, scenarios 10–11) | C4 kinds vs scenario 10 (NC3-3, FE2-9) |
| SD9 | Card seat `advisor`/`message-stream`; plain fallback strips `◇` | MANDATORY (P1, D11) | fallback seat and `◇` in `plainHead` (FE2-8) |
| SD10 | Card built from parameterized family helpers | RECOMMENDATION | FE2-8, C18 |
| SD11 | One deep advisor module behind a small interface | RECOMMENDATION | structure |
| SD12 | Picker module free of profile and advisor state | RECOMMENDATION | D16, R3 |
| SD13 | `execute` reads the file, then checks the seat | RECOMMENDATION | order of checks (scenarios 9–11) |

## Feature-critic report

Final report: [`docs/features/advisor-review.md`](../features/advisor-review.md), handoff `advisor/feature-review-3`, package `advisor/definition-4`, verdict `READY WITH WARNINGS`, with no open blocker, no undisposed warning, and R1–R7 `risk accepted`. Every Evidence-gaps item it left to the specification is resolved above (SD3–SD10, SD13); OD1 is a scenario-wording conflict left to the developer.

## Resolved specification questions

- OD1, Esc on the thinking-level screen of `/workflow:advisor`: the developer chose (a) on 2026-11-20. Esc on the thinking screen returns to the model list; Esc on the model list closes; nothing is written in either case. The shared picker stays identical for both commands (D16, R3). Brief scenario 4 records the same wording.

## Decisions recorded after approval

- DEV-1, when to consult (developer, 2026-11-20): refines the wording of D4's guidance. Orientation, such as finding files and reading what is there, is not substantive work: the parent consults after orienting and before writing, choosing an interpretation, or building on an assumption. Short reactive tasks, where the tool output just read dictates the next action, skip the advisor. On multi-step tasks the parent consults at least once before settling on an approach and once before declaring done, with the deliverable saved (file written) before that last call. It also consults when stuck or when changing approach, and when its own evidence contradicts the advice it surfaces the conflict in one more call instead of switching silently. No gate, budget, or chaining is added (D1).
- SD8 refinement, overflow (developer decision SPEC-1(a), 2026-11-20): any response Pi's `isContextOverflow` recognizes maps to `overflow`, including a `length` stop with no output and an empty `stop` above the context window. The text is the provider's message when there is one, then the hint. A `stop` that carries advice stays advice.
- Advisor model file mode (scenario 7, D15): after `/workflow:advisor` writes the file with `writeJsonAtomically`, the file's mode gains owner-read. `writeJsonAtomically` keeps an existing file's mode, so without it a choice made over an unreadable file would stay unreadable and read as "no model".
- Provider failure without a message (developer, 2026-11-20, PR #397 review): when the provider's message is missing or empty after the terminal-safe pass, the `provider` failure text is `The advisor's provider failed without a message.`
- Advice cut at the output limit (developer, 2026-11-20, PR #397 review): a `length` stop with non-empty advice is not a failure. The result is the advice followed by a blank line and `(The advice was cut off at the advisor model's output limit.)`, the tool error stays off, `details` carry no failure kind, and the card shows done.
