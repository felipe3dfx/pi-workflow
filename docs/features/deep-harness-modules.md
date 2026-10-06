# Feature brief: deep harness modules

Status: CONFIRMED by the owner. Reviewed by `feature-review`: READY.

Domain Authority Handoff: `GLOSSARY.md` (present, root-selected) and the accepted ADRs in `docs/adr/`.

## Problem and user

The user is the maintainer of pi-workflow. Each harness rule that the domain treats as one decision is spread across several modules today, so one change needs edits in several places, and a test must reach past the module that owns the rule:

- Seating is repeated in two places with two different error contracts for the selection.
- Child result delivery (ADR 0010) is split between the child-session core and the composition root. That includes the rule for which results wake the parent: while another child works, a completed result with `done`, `pass`, or no Verdict does not wake it.
- The tool gate's block policy (ADR 0008) lives in the composition root, next to a no-op turn hook.
- Screen places live outside the Shell, and the above-input place cannot keep its own order, so the todo occupant must know about the child-session occupant.
- Chrome's prototype patching (ADR 0007) is implemented twice, and a test reads a private mark.
- The terminal-safety rule for text from a child, a model, or the user has five definitions.
- The agent directory is honored by some documents and ignored by others. Tests redirect Jev routing by mutating the process environment.
- Some shared Visual language primitives are imported the wrong way: a feature module imports them from an unrelated feature module.

The operator is a secondary user. The operator must not notice the change.

## Desired outcome

Each of these rules has one owner with a small interface, and tests cross that interface. The composition root only wires modules together. The operator sees the same harness, apart from the approved deviations.

## Scope

In scope, one owner each:

1. Chrome prototype patching and the theme read.
2. Terminal-safe text for every renderer and validator.
3. The shared Visual language primitives whose imports point the wrong way, where a feature module imports them from an unrelated feature module.
4. The agent directory. One injected agent directory redirects every document: the selection, Jev routing, model profiles, `mcp.json`, and the user's Pi `settings.json`. The atomic writer and the plain-record check are shared. Each document keeps its own read and its own error wording.
5. The tool gate and the child tools' offer.
6. Child result delivery, including the wake rule for child results.
7. Screen places in the Shell.
8. Seating.

Out of scope:

- Modules that are already deep: the companion workflow, the model profile editor flow, the child-session core (launch queue, stall watch, running limit, `ask_parent`), except that delivery moves into it, CodeGraph access adapters, and the MCP and Pi settings plan and apply logic.
- Command names, message types, file names, schema versions, the companion catalog, the place map, and the occupant order.
- A new harness capability, a Pi version guard for patches, todo render coalescing, the fixed header, child bash, and compact rendering's behavior. Compact rendering still reads seating from the new owner.
- Moving `report`, which notifies or writes to stderr without a UI. It is neither a Visual language primitive nor a screen place.

## Scenarios

- **Seating at session start.** A ready selection is seated, then every harness capability offers or hides its tools in a fixed order. The one exception is `reply_child`, which stays available while a child waits for an answer (D10). An absent selection seats nothing and keeps the current seating. A refused selection reports its reason, with today's wording, and keeps the current seating. The seating owner returns one refusal, and each caller handles it: session start reports it and keeps the current seating, and Configure reports it and does not open the guide. If one capability's offer fails, the later ones are not offered and the new selection stays current, as today.
- **Configure.** Opening the command reads the selection from disk. An unreadable or invalid selection reports the error and does not open the guide (ADR 0009). Otherwise the guide opens from the selection on disk, without reseating it (deviation 3). The Apply plan's seat and unseat lines compare against the selection that is seated now. Confirming saves the selection and the Jev routing choice, seats the selection, then applies the companion, MCP, and Pi settings outcome, in today's order. A write failure on confirm, for the selection or for Jev routing, stops before seating, and Pi reports the error as it does today. A saved selection whose routing write failed is seated by the next session. Closing without confirming applies nothing.
- **Delivery.** Results that do not wake the parent wait while a sibling works. Any other result, or the last child settling, wakes the parent with every pending result in one message. A consumed result is never delivered again. A failed delivery keeps the results pending, reports it, and is retried at the next boundary. A child question first flushes the pending results, and the question is still sent when that flush fails. Delivery happens at a turn boundary, except that an idle parent receives results as soon as they end. While child session is unseated, children already launched, queued or running, still start, finish, and deliver. Unseating never loses a pending result (ADR 0010). While any child waits for the parent's answer, the parent can answer it with `reply_child`, whether or not child session is seated. When no child waits and child session is unseated, `reply_child` is hidden again (deviation 4). The legacy case in D10 is the exception.
- **Tool gate.** While child session is unseated, every parent tool runs. While it is seated, the gate applies the routing decision for the current user message: with Jev routing off, gated tools run; with it on, Jev's answer applies, and after a child launches for that message, gated tools run without asking Jev again. A reseat or a Jev routing change within one user message reuses the decision already made for that message, as today. A blocked call from a `codemode` script is also steered to the parent, so the script cannot hide it.
- **Legacy spawn package.** When a legacy spawn package provides the child tools, the harness warns, offers no child tools, and installs no tool gate, even while child session is seated, as today. A legacy package that appears after the first offer leaves that offer and the gate as they were.
- **Above-input place.** Each seated occupant renders once per frame, in placement order (child session, then todo). An unseated occupant renders nothing and is not computed.
- **Header.** The Pi header count of working children refreshes while child session is seated, whether or not the children widget renders. Chrome keeps repainting the header through its current path. Unseating clears it in the same session.
- **Hostile text.** Control and bidi characters from a child, a model, or the user never reach the terminal. A block keeps its newlines and expands tabs. Only the character class and tab expansion are unified. Each renderer keeps its current trim, CRLF, and escape-sequence handling.
- **Agent directory.** One injected agent directory redirects every document. Each document reads as it does today, with its own error wording. Writes go through one atomic writer and keep the file mode. Model profiles still refuse to overwrite a change made on disk after the editor opened. An unreadable or invalid Jev routing document leaves routing off without a report, as today.
- **Chrome patching.** Patching twice leaves one layer. A method that another extension replaced is not replaced again. Restoring returns every method that still has pi-workflow's layer on top to its pristine shape. Two patch sets never take each other's layer for the original. The patches are restored only when the session quits. A reload keeps them, and the marks recognize the layer. The test that covers restore on quit is kept.
- **Theme read and primitives.** The theme read and the Visual language primitives that move behave as today, including their errors.

## Decisions

| # | Decision | Disposition |
|---|----------|-------------|
| D1 | All eight candidates are in scope, as one feature. | Confirmed by the owner. |
| D2 | Delivery happens in slices. Each slice is independently mergeable, keeps `npm run check` green, and changes no operator behavior beyond the approved deviations. | Confirmed by the owner. |
| D3 | The behavior oracle is operator-visible output from the tests that drive the extension: rendered lines and their order, messages, and tool exposure. A slice changes that output only where its scenario or an approved deviation requires it. Assertions about internal widget keys or widget install and clear calls may change when a slice merges widgets. | Confirmed by the owner (review W10). |
| D4 | No backward-compatibility layer. Obsolete exports and extension options are removed, not aliased. No external caller is known. The only known callers are this repository's tests. | Confirmed by the owner's global standards. |
| D5 | The header stays a screen place. Chrome does not read the working count from child session directly, because ADR 0009 says the Shell does not name the capability. | Derived from ADR 0009. |
| D6 | Two ADRs are amended. ADR 0007's restore sentence matches current behavior: the patches are restored when the session quits and kept across a reload. ADR 0009 clarifies that unseating starts no new work, while work already accepted finishes and the parent can still answer a launched child's question (D9, D10). ADRs 0003, 0008, and 0010 do not change wording. Each ADR's enforcement moves to one owner. | Confirmed by the owner (reviews W9 and A1). Checked by `feature-review`. |
| D7 | The glossary gains Selection, Seating, Agent directory, and Pending result. | Confirmed by the owner. Applied to `GLOSSARY.md`. |
| D8 | The shared patch owner is part of Chrome. ADR 0009 keeps Chrome's patches in the Chrome module, and ADR 0007 keeps the source notes beside the replacement logic. | Derived from ADRs 0007 and 0009. |
| D9 | Unseating starts no new work, but work already accepted still finishes. Children already launched, queued or running, still start, finish, and deliver while child session is unseated, as today. A pending result is never lost to unseating. | Confirmed by the owner (reviews W7 and A1). Stated in ADR 0009 as amended, consistent with ADR 0010. |
| D10 | A child question that reached the parent can be answered, unless a legacy spawn package is detected after the first offer. Then the harness changes no child tool's offer, `reply_child` included, and the offer stays as the legacy spawn package scenario leaves it. Today `reply_child` is hidden while child session is unseated, so the parent cannot answer a question that was delivered. | Confirmed by the owner. Fixed in this feature as deviation 4. |
| D11 | A capability that only needs to know whether it is seated, such as the result card in the message stream, satisfies ADR 0009's "painted through the screen place it declares" by checking that it is seated at its declared place. No paint call is required at a place that does not combine its occupants into one paint: the message stream, where each item renders itself, and the overlay, where only one is open at a time. The above-input place still paints its occupants in order. | Confirmed by the owner (to-spec). |

## Shared capabilities and invariants

| Capability | Comparison implementation | Invariant to preserve |
|------------|---------------------------|-----------------------|
| Chrome patching | The two current Chrome patch modules (identical algorithms) | ADR 0007 as amended: idempotent, restored only when the session quits, and kept across a reload. Current code, preserved: a foreign replacement is left untouched, and the module-reload marks are unchanged. |
| Child result delivery | The current root delivery plus the child-session pending results | ADR 0010, sentence by sentence. The message content and details are byte-identical. Delivery does not depend on seating. |
| Tool gate | The current root `tool_call` hook | ADR 0008, ADR 0009, and the routing-owner spec: one routing decision per user message, reuse after a launch, Launch blocked never kept, the gate inert while child session is unseated, and the `codemode` steer. No gate while a legacy spawn package provides the child tools. |
| Screen places | The current place registry | ADR 0009: the place map, the occupant order, and no computing a contribution only to discard it. |
| Seating | The two current seating sequences, at session start and on Configure | One refusal, handled by each caller. An absent selection seats nothing. The offers keep their fixed order. The only tool kept while unseated is `reply_child` for a waiting child (D10), except that an offer kept by the legacy spawn package scenario stays as it is. |
| Model profiles | The current change-on-disk check | Refuse to overwrite a document that changed after the editor opened. |
| Jev routing | The current routing document | Off when absent, unreadable, or invalid, with no report. A change saved by another Pi process takes effect without a restart. |
| Terminal-safe text | The current five definitions | No C0 or C1 control or bidi control reaches the terminal, except the newline kept in a block. Each renderer keeps its trim, CRLF, and escape-sequence handling. |

## Approved deviations

Approved by the owner. Each one is visible only in the edge case named here.

1. The task box always sits above the status row. Today it can land below the status row when child session is unseated and the first task arrives mid-session.
2. A tab in operator question text renders as three spaces instead of one, as in the child views and the result card.
3. Opening `/workflow:config` no longer reseats the selection from disk, so closing it without confirming changes nothing. The guide opens from the selection on disk, and the Apply plan's seat and unseat lines compare against the selection that is seated now. ADR 0009 says closing applies nothing, and Apply shows which capabilities will be seated or unseated.
4. While a child waits for the parent's answer and child session is unseated, `reply_child` stays available, so the parent can answer. Today it is hidden, and the delivered question cannot be answered. When a legacy spawn package is detected after the first offer, the harness changes no child tool's offer, `reply_child` included, as in the legacy spawn package scenario.

## Risks

- Shell state is process-global, as it is today. When two extension instances run in one process, the last one to occupy a place wins.
- Removing extension-level options breaks any external caller that passed them. None is known.
- Delivery timing moves into the child-session core. Idle delivery and the turn-boundary flush must keep today's ordering.

## Dependencies

- The Pi peer range declared in `package.json`.
- Pi activates a tool that is registered again with a new exposure during a session. Deviation 4 relies on it.
- Pi's above-editor widget order. A widget that is set again moves to the end, so the order follows which widget is set last on each session start.
- Pi's `turn_end`, `agent_settled`, and `session_shutdown` events, and its idle check.
- Pi's steering messages that trigger a turn.
- The `tool_call` event's parent tool call, which carries the `codemode` steer.

## Prototype

None recommended. No functional question is open that an artifact would resolve. The extension-level tests act as the oracle.

## Sources

- The deepening survey of `extensions/` and its verification against the current code.
- The working technical draft `docs/specs/deep-harness-modules.md`. That draft is input for `to-spec`, not the specification.
- ADRs 0003, 0007, 0008, 0009, and 0010, `docs/specs/routing-owner.md`, and `GLOSSARY.md`.

## Open questions

None.

## Evidence gaps

None known.
