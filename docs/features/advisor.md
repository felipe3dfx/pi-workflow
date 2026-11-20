# Advisor — feature brief

Status: approved functional definition; critique `advisor/feature-review-3` READY WITH WARNINGS ([review](advisor-review.md)). Definition package: `advisor/definition-4`. Parent: none yet.
Prototype: branch `prototype/advisor-card`, commit `93c0b5e87f2e43597a1cc1b0a403b6cbbc843b19`, [approved UI contract v1](https://github.com/felipe3dfx/pi-workflow/blob/93c0b5e87f2e43597a1cc1b0a403b6cbbc843b19/prototype/advisor-card/approved-advisor-card-v1.md), disposition `reference-only`.

## Problem and user

The operator of Pi with this harness has no way for the parent session to get an independent second opinion from a stronger model before committing to an approach, when stuck, or before declaring work done. Source: developer request of 2026-11-20, with `philipbrembeck/pi-advisor` as the reference.

## Desired outcome

The parent session can consult an advisor model that sees what the parent sees, has no tools, and returns concise advice shown in its own card. The operator turns it on or off in `/workflow:config` and chooses its model with a dedicated command.

## Scope

In: one advisor tool offered to the parent session; one `Advisor` harness capability row in `/workflow:config`; one `/workflow:advisor` command that chooses the advisor model and thinking level; the guidance that travels with the tool; the advisor's fixed instructions; the advisor card in the message stream; failure reporting; the advisor in the `orchestrator` instruction while offered.

Out: automatic gates (plan, failure, completion, loop), call budgets, follow-up chaining, outcome ledger, fallback model, Jev or scout classifiers, git or file attachments, secret redaction, editable advisor instructions, an advisor in child sessions, chat-driven configuration, a bundled skill, a `/workflow:status` line, any change to `/workflow:models` or model profiles, and a capability-tolerance rule for any capability other than the advisor.

## Scenarios, states, actions, and errors

1. Fresh install, no selection file: `Advisor` is on, like every harness capability. No advisor model is set, so the tool is not offered.
2. Existing selection without an `advisor` key: read as `advisor: on`; every other value is kept. The selection is not refused. Without a model the tool is still not offered.
3. `/workflow:config`: the Capabilities section shows `[x] Advisor` / `[ ] Advisor`, staged and applied with the rest of the plan. Its description names `/workflow:advisor` as the way to choose the model.
4. `/workflow:advisor` with the capability seated and the TUI available: an overlay lists the available models with a filter, then the thinking levels that model supports. Choosing the thinking level writes the advisor model file in the agent directory at once and takes effect in the same session; Esc never writes: on the thinking screen it returns to the model list, and on the model list it closes (OD1, developer, 2026-11-20). The picker is extracted from `/workflow:models`.
5. `/workflow:advisor` with the capability unseated: refused with `Advisor is disabled. Enable it in /workflow:config.` Without the TUI: refused, as `/workflow:models` does.
6. The tool is offered when the capability is seated AND a valid advisor model is set, evaluated at session start, on seating changes, and on saving a model; the file is not watched for outside edits. A valid advisor model is a well-formed advisor model file; availability in Pi and thinking support are checked at call time (scenario 10). A call made after an outside edit left the file missing or invalid returns a readable failure. A call already running finishes.
7. An unreadable or invalid advisor model file counts as no model: the tool is not offered, and `/workflow:advisor` opens and overwrites it on the next choice, with no changed-on-disk check.
8. Parent calls the tool (no parameters): the advisor model receives the parent's conversation projected to text without truncation (compaction summary, messages, and tool calls and results), the system prompt of the parent's latest request as captured at request time (including harness sections such as Delegation mode), and the advisor's fixed instructions. No tool declarations are sent. Its Markdown answer returns as the tool result.
9. The advisor card follows the approved UI contract v1: `◇ Advisor consulting… <model> (<thinking>)` while running; when done, elapsed time and model with a 3-line preview that expands with Pi's tool expand key, a click, or the transcript cursor; `failed` with the reason under the header, including empty advice; `stopped` for an operator abort; `refused` for a late call (scenario 11). The model always shows when `execute` was reached. Unseated, past cards fall back to plain text.
10. Failure returns a readable tool error, shown as a failed card, and never blocks the session: advisor model file missing or invalid after an outside edit (scenario 6), model not available in Pi, thinking level not supported, provider or auth error (including a context larger than the advisor model's window, recognized from the provider's failed response, with `choose a larger advisor model` and no token counts; this replaces the overflow line of UI contract v1), empty advice (`The advisor returned no advice.`), and operator abort (Esc, shown as stopped). No retry, no fallback, no truncation.
11. A call that arrives after the tool was withdrawn returns a readable refusal, as CodeGraph does.
12. In `orchestrator` Delegation mode, while the tool is offered, the parent's instruction lists consulting the advisor among what it may do itself.
13. Child sessions never receive the tool.
14. The advisor tool is a harness message, exempt from action authorization like `reply_child`, by ADR 0030's amendment of ADR 0025: sending the parent's context to the advisor's provider is the same kind of egress as the parent's own model call, which authorization does not classify, possibly to a different provider (R1); a bridged advisor model that runs its own tools is accepted risk R4.

## Decisions

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
| D10 | The advisor has its own card in the message stream, per approved UI contract v1, including the `chrome-groups.ts` `pointAt` change for `◇` | developer | conversation 2026-11-20; prototype `93c0b5e` | accepted |
| D11 | The capability declares the `overlay` and `message-stream` places | developer | critique FE3, 2026-11-20 | accepted |
| D12 | No `/workflow:status` line | developer | critique SP4, 2026-11-20 | accepted |
| D13 | Choosing the thinking level saves at once; no save step or discard prompt | developer | critique SP7, 2026-11-20 | accepted |
| D14 | The advisor tool is a harness message exempt from action authorization | developer | critique NC2-2 and FE2-6 (Q6), 2026-11-20; ADR 0025 as amended by ADR 0030 | accepted |
| D15 | A valid advisor model is a well-formed file; availability and thinking are checked at call time | developer | critique FE2-5 and SP2-4, 2026-11-20 | accepted |
| D16 | The picker is extracted from `model-profiles-editor.ts`; Pi's `ModelSelectorComponent` is not used | developer | critique FE2-3, 2026-11-20 (it needs a `ModelRuntime` extensions do not receive) | accepted; replaces SP6's open choice |

## Assumptions

- A1: the command is named `/workflow:advisor` and joins the `/workflow` usage line. Confirmed by the developer on 2026-11-20.
- A2: an advisor model equal to the session model is allowed; nothing checks it. Confirmed by the developer on 2026-11-20.
- A3: UI text stays in English, as in the rest of the harness. Repository convention.
- A4: the advisor's usage enters Pi's session cost through the tool result's `usage`. Confirmed by the critique (C15).

## Open questions

None. Q6 resolved by D14.

## Deviations

- D3c adds a tolerance rule to `readSelection`, which departs from the developer's no-backward-compatibility principle and from ADR 0009. Accepted by the developer on 2026-11-20 and recorded in ADR 0030.
- `/workflow:advisor` is a command outside `/workflow:config`, following the `/workflow:models` precedent under ADR 0012; recorded in ADR 0030.

## Shared capabilities and invariants

- Model picker: `extensions/model-profiles-editor.ts` (`catalogScreen`, `thinkingScreen`), extracted so both commands share it; `/workflow:models` behavior stays identical.
- `extensions/workflow-settings.ts` (`createDelegationMode`): the pattern the advisor model file follows (an invalid file reads as absent and is overwritten); `writeJsonAtomically` for the write.
- `extensions/configure.ts` (`capabilities`, `readSelection`) and `extensions/shell.ts` (`placement`, `seated`): the capability joins the list and declares `overlay` and `message-stream`.
- `extensions/tool-offer.ts` (`offerTool`) and `extensions/codegraph-tool.ts` (`syncCodeGraphTool`, unseated refusal): the offer/withdraw pattern.
- `extensions/child-launcher.ts` (`profilePair`): the availability and thinking checks and their messages.
- `extensions/delegation-mode.ts`: the `orchestrator` keep-list gains the advisor while offered, as `todo` and `operator-questions` do.
- `extensions/child-result-card.ts` (`frame`, `paintCard`, `bodyLines`) and `extensions/chrome-groups.ts` (`pointAt`): the card family and cursor.
- `child-runtime.ts` `context_with_system` capture: the precedent for the request-time system prompt; the advisor's handler registers after `registerDelegationMode`.
- Harness messages (`reply_child` marker at `extensions/child-sessions.ts:1794`, hook map in `extensions/pi-workflow.ts`): the authorization exemption (D14).
- `scripts/validate-pi-package.mjs` and the README command table: list the new command.
- Invariant: unseating starts no new work; an accepted call finishes (ADR 0009).

## Dependencies

- `domain-modeling` (resolved 2026-11-20): `Advisor` defined in `GLOSSARY.md` and added to Harness capability; [ADR 0030](../adr/0030-advisor-capability.md) supersedes ADR 0009's invalid-selection clause for the advisor only. The advisor's fixed instructions are not a Contract.
- `domain-modeling` (resolved 2026-11-20, critique NC6, NC2-3, FE6, FE7): ADR 0030 records the advisor's places and amends ADR 0025 (D14) and ADR 0015 (scenario 12), with Status notes; GLOSSARY "Delegation mode" includes consulting the advisor; ADR 0030 records D3c and the ADR 0012 precedent; ADR 0009 and ADR 0012 Status notes; the advisor model in the GLOSSARY "Agent directory" entry.
- Pi 1.5 `modelRegistry.streamSimple` with model, thinking, abort signal and usage (critique C14, compatible).

## Risks

Disposition of R1–R7: `risk accepted` by the developer on 2026-11-20 (critique NC10, FE2-1 and FE3-2), reason: accepted trade-offs of a minimal advisor; source: conversation 2026-11-20.

- R1: the full parent context, including tool results, goes to the advisor's provider, which may differ from the parent's.
- R2: each call adds cost and latency; with no budget, the model alone decides how often to call.
- R3: changing the model picker could regress `/workflow:models`.
- R4: a virtual or bridged advisor model (for example `claude-bridge`) may run its own tools, contradicting "the advisor has no tools" (critique FE8).
- R5: global `ctrl+o` expands every tool row, so long advice expands with them (prototype R3).
- R6: system prompt edits by extensions loaded after pi-workflow, or by `before_provider_request`, do not reach the advisor (critique FE2-1).
- R7: a provider may truncate the context silently (for example Ollama), and nothing detects it (critique FE3-2).

## Evidence gaps

- Domain authority consumed from `docs/agents/domain.md` (`present (root-selected)`, `GLOSSARY.md`); no separate handoff artifact.
- Left to the specification: the exact text projection format; whether the in-flight advisor call appears in the projection; `execute` always returning details; the card's own plain-text fallback seat and `◇` in `plainHead`; the captured prompt carrying the parent's advisor guidance; reconciling UI contract v1 C4 failure kinds with scenario 10 (no `overflow` count, a kind for empty advice).
