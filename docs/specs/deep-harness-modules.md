# Deep harness modules

Status: PUBLISHED (#188).

Package: `docs/features/deep-harness-modules.md` (sha256 `8c168ea3…`), CONFIRMED by the owner, with `GLOSSARY.md` (`e950ed8d…`), ADR 0007 as amended (`cf5a7dba…`), and ADR 0009 as amended (`c5f91466…`).
Review handoff: the Domain Authority review, renewed twice, consistent with notes and with no conflict or warning, plus the owner's dispositions W1 to W10, D10, A1, and A2, and the reverification of the D10 legacy exception and D11 with no blocker or warning.
Verdict: READY.

## Problem

The maintainer of pi-workflow changes harness rules. Each rule that the domain treats as one decision is spread across several modules today. One change needs edits in several places. A test must reach past the module that owns the rule.

- Seating is repeated at session start and in Configure, with two error contracts for the selection.
- Child result delivery (ADR 0010) is split between the child-session core and the composition root. That includes the wake rule.
- The tool gate's block policy (ADR 0008) lives in the composition root, next to a turn hook with an empty body.
- Screen places live outside the Shell. The above-input place cannot keep its own order, so the todo occupant must know about the child-session occupant.
- Chrome's prototype patching (ADR 0007) is implemented twice. A test reads a private mark.
- The terminal-safety rule for text from a child, a model, or the user has five definitions.
- The agent directory is honored by some documents and ignored by others. Tests redirect Jev routing by mutating the process environment.
- Chrome imports shared Visual language primitives and a time seam from child-session feature modules.

The operator is a secondary user. The operator must not notice the change, apart from the approved deviations.

## Solution

Eight rules each get one owner with a small interface. Tests cross that interface. The composition root only wires modules together. The operator sees the same harness, apart from the four approved deviations.

| # | Owner, by role | Rule it owns |
|---|----------------|--------------|
| 1 | Chrome's patch set, and the theme read | Patching Pi prototypes and restoring them (ADR 0007), and reading Pi's theme |
| 2 | Terminal-safe text | No control or bidi character from a child, a model, or the user reaches the terminal |
| 3 | Visual language primitives and the time seam | Shared frame, rhythm, and timing that the Shell and the features both use |
| 4 | Agent directory | One injected directory for every agent document, one atomic writer, one plain-record check |
| 5 | Tool gate and the child tools' offer | The parent-tool gate (ADR 0008, ADR 0009) and the child tools' exposure, including `reply_child` (D10) |
| 6 | Child result delivery | ADR 0010, including the wake rule, inside the child-session core |
| 7 | Shell screen places | Seated state, the place map, the above-input order, and the header reading |
| 8 | Seating | Read the selection, seat it, then offer each capability's tools in a fixed order |

## User stories

- As the maintainer, I change one harness rule in one module, and one test suite covers it.
- As the maintainer, I add a harness capability's offer to one ordered list. I do not edit two seating sequences.
- As the maintainer, I audit terminal safety against one character class.
- As the maintainer, I test routing, model profiles, and the selection against a temporary agent directory without mutating the process environment.
- As the maintainer, I test child result delivery through the child-session core with a recording adapter, without loading the whole extension.
- As the maintainer, I write an above-input occupant without knowing which other occupants exist.
- As the operator, I see the same header, widgets, messages, menus, commands, and tools as before, apart from the approved deviations.
- As the operator, I can answer a child's question even after I unseat child session (deviation 4).

## Implementation decisions

Each structural decision carries a label. **Mandatory** means an applicable authority, an accepted decision (D1 to D11), an approved deviation, a consumer contract, or an indispensable dependency requires it. **Recommendation** means an evidenced design choice that serves a stated need. Implementation may replace a recommendation with another design that preserves every mandatory decision and invariant.

These decisions apply to every module:

- **Mandatory.** The composition root only wires modules together and holds no policy. Source: ADR 0003, which makes the extension the adapter and puts harness policy in deeper modules, and the brief's desired outcome. Necessity: every rule below leaves the root.
- **Mandatory.** No compatibility layer. Obsolete exports and extension-level options are removed, not aliased. Source: D4. Necessity: the only known callers are this repository's tests.
- **Mandatory.** Operator-visible output is the behavior oracle: rendered lines and their order, messages, and tool exposure, as driven by the tests that load the extension. A module change alters that output only where a scenario or an approved deviation requires it. Assertions about internal widget keys or widget install and clear calls may change. Source: D3. Necessity: it defines what "unchanged" means for every module below.
- **Mandatory.** Each module is delivered in independently mergeable steps that keep `npm run check` green and change no operator behavior beyond the approved deviations. Source: D2 and `AGENTS.md`. Necessity: it constrains how the native relationships below may be ordered.

### 1. Chrome patching and the theme read

Evidence: Chrome's message patch module and its menu patch module carry the same patch algorithm, apart from their target tables. Their mark names differ only by the set's name. The theme read is copied in three Chrome modules. A message-patching test reads a private mark.

- **Mandatory.** One patch algorithm serves both patch sets, and Chrome owns it. Source: D8, ADR 0009 ("Chrome's patches stay in the Chrome module"), and ADR 0007's consequences. Necessity: scope item 1 requires one owner, and D8 places that owner inside Chrome. This resolves the authority review's watch item R4: the shared patch owner is a Chrome module. It is not a Shell-wide or generic utility, and no module outside Chrome uses it.
- **Mandatory.** The source notes that name the Pi version and the replicated Pi functions stay in the message and menu patch modules, beside their replacement logic. The shared algorithm replicates no Pi function and needs no source note. Source: ADR 0007, which names `extensions/chrome-messages.ts` and `extensions/chrome-menus.ts` as the patch modules that carry source notes. Necessity: the source notes must stay where every Pi upgrade re-verifies them.
- **Mandatory.** Patching is idempotent: patching twice leaves one layer. A method that another extension replaced is not replaced again. A wrapping target wraps whatever method is current. A target absent on its prototype is skipped. Source: ADR 0007 as amended, the brief's Chrome patching scenario, and the Chrome patching invariant ("Current code, preserved"). Necessity: approved behavior.
- **Mandatory.** Restoring returns every method that still has pi-workflow's layer on top to its pristine shape. A method that another extension wrapped after pi-workflow is left as it is. An inherited method that was patched is removed again, and a method that was the prototype's own gets its original back. Source: the brief's Chrome patching scenario, as qualified by lens finding L3-3. Necessity: approved behavior.
- **Mandatory.** The patches are restored only when the session quits. A reload, a new session, a resume, or a fork keeps them, and the marks recognize the layer. Source: ADR 0007 as amended and D6. Necessity: approved behavior. Restoring on every shutdown would also discard the chat restyling state on resume and fork.
- **Mandatory.** The module-reload marks keep today's process-wide identities. Two patch sets never take each other's layer for the original. Source: the Chrome patching invariant and the Chrome patching scenario. Necessity: a module that loads again in the same process must recognize its earlier layer.
- **Mandatory.** The marks are private to the patch owner. No test reads a mark. Source: the brief's problem statement and desired outcome ("tests cross that interface"). Necessity: the private-mark test is one of the defects this feature removes.
- **Recommendation.** The interface is one patch set per name, built from a target table, with one patch operation and one restore operation. A target says whether it replaces Pi's pristine method or wraps the current one. The set's name derives its marks, so the two existing names keep today's marks. Evidence: the two patch modules differ only in their tables and names. Need: the cross-set invariant then follows from keyed marks and needs no design of its own, as lens finding L2-10 recommends. The patch set is the highest useful seam, and throwaway classes exercise it fully.
- **Mandatory.** There is one theme read. It behaves as today, including its error when Pi has not set the theme. Source: scope item 1 and the brief's "Theme read and primitives" scenario. Necessity: approved behavior.
- **Recommendation.** The Visual language owner holds the theme read, not the patch algorithm. Evidence: the glossary defines Visual language as "the shared theme, frame, and rhythm of the shell", and reading the theme is not patching. Need: one home for the theme read that the Chrome patch modules and other Chrome modules share without importing each other.

### 2. Terminal-safe text

Evidence: five definitions share the class of C0 and C1 controls and bidi controls today: the task-text sanitizer and its multiline variant, the model profile validator, the model profile editor's sanitizer, and the operator question's class. The children box imports the task-text sanitizer from the todo header module.

- **Mandatory.** One owner defines the unsafe class: every C0 or C1 control character and every bidi control character. Every renderer and validator of text from a child, a model, or the user uses that one class. Source: scope item 2 and the Terminal-safe text invariant. Necessity: approved behavior and the security invariant.
- **Mandatory.** There are two forms. The line form replaces every unsafe character. The block form keeps each newline and expands each tab to three spaces, and replaces every other unsafe character. The replacement for an unsafe character stays as it is today. Source: the brief's Hostile text scenario ("A block keeps its newlines and expands tabs") and deviation 2. Necessity: only the class and the tab expansion are unified.
- **Mandatory.** Each renderer keeps its own trim, its own CRLF handling, and its own escape-sequence handling. The owner neither trims nor strips escape sequences. Stripping the harness's own styling from text it already themed stays with the renderers that do it today. Source: the brief's Hostile text scenario and the Terminal-safe text invariant (review W8). Necessity: approved behavior. Stripping escape sequences inside the owner would change how every hostile string renders.
- **Mandatory.** A tab in operator question text renders as three spaces. Source: deviation 2. Necessity: approved deviation.
- **Recommendation.** The interface is the two forms only. A validator asks whether the line form of the text equals the text. Evidence: a third predicate equals that comparison, because the line form replaces every unsafe character (lens finding L2-11). Need: a smaller interface with no second statement of the class.
- **Recommendation.** The owner is a leaf module that no feature owns. Evidence: the children box imports the sanitizer from the todo header, an unrelated feature module. Need: renderers in Chrome, child session, todo, model profiles, and the operator question import the class without a wrong-direction edge.

### 3. Visual language primitives

Evidence: Chrome, which belongs to the Shell, imports the spread helper, the spinner frames, and the spinner period from the children box. It imports the time seam and its timer adapter from the child-session core. The result card imports elapsed time through a re-export in the children box, while the child projection owns it. Feature modules import the editor margin helper from Chrome's editor module, which is the right direction.

- **Mandatory.** A shared primitive that a module imports from an unrelated feature module moves to an owner that both sides may depend on. Source: scope item 3. Necessity: the Shell must not depend on a capability's module, because ADR 0009 says the Shell does not name the capability.
- **Mandatory.** Each moved primitive behaves as today, including its errors. Source: the brief's "Theme read and primitives" scenario. Necessity: approved behavior.
- **Mandatory.** The notify-or-stderr report helper does not move. Source: the brief's out-of-scope list. Necessity: it is neither a Visual language primitive nor a screen place.
- **Mandatory.** The wake rule for child results is not part of this item. It belongs to child result delivery. Source: scope item 6 and the owner's disposition of review W3. Necessity: approved scope.
- **Recommendation.** The spread helper, the spinner frames, and the spinner period move to the Visual language owner. Evidence: the glossary assigns rhythm to Visual language. Need: Chrome stops depending on the children box.
- **Recommendation.** The time seam and its timer adapter move to their own leaf module. Evidence: it already has a production adapter and test adapters, so it is a real seam. It holds no child-session knowledge. Need: Chrome stops depending on the child-session core, and both keep the same seam for tests.
- **Recommendation.** The re-export of child projection values through the children box is removed, and importers use the child projection. Evidence: the re-export is a pass-through. Need: one owner per value, as D4 requires for obsolete exports.
- **Recommendation.** The editor margin helper stays in Chrome's editor module. Evidence: features import it from Chrome, which is the Shell, so the import already points the right way (lens finding L2-4). Need: no relocation without an ownership payoff.

### 4. Agent directory

Evidence: the selection, `mcp.json`, and the user's Pi `settings.json` resolve the directory through an option or the environment. Jev routing resolves it from the environment only. Model profiles take a path option. The atomic writer and the plain-record check are housed in the MCP configuration module, and Configure keeps a second copy of the record check. Every writer already uses that atomic writer, which keeps the file mode.

- **Mandatory.** One agent directory, injected once, redirects every document: the selection, Jev routing, model profiles, `mcp.json`, and the user's Pi `settings.json`. Source: scope item 4 and the glossary entry Agent directory. Necessity: approved behavior.
- **Mandatory.** Each document keeps its own read and its own error wording. There is no shared read helper. A dangling symbolic link behaves as it does today for each document. Source: scope item 4, the Agent directory scenario, and the owner's disposition of review W1, which removed the dangling-link deviation. Necessity: approved behavior.
- **Mandatory.** Writes go through one atomic writer that keeps the file mode. There is one plain-record check. Source: scope item 4 and the Agent directory scenario. Necessity: approved behavior.
- **Mandatory.** Model profiles still refuse to overwrite a document that changed on disk after the editor opened. Source: the Model profiles invariant. Necessity: approved behavior.
- **Mandatory.** Jev routing is off when its document is absent, unreadable, or invalid, with no report. The choice is read on each use, so a change saved by another Pi process takes effect without a restart. Source: the Jev routing invariant, ADR 0008, and `docs/specs/routing-owner.md`. Necessity: consumer contract.
- **Mandatory.** The MCP and Pi settings plan and apply logic keeps its behavior and its refusal texts. Only its directory and its writer come from this owner. Source: the brief's out-of-scope list. Necessity: approved scope.
- **Recommendation.** The seam is one extension-level option for the agent directory, resolved once when the extension loads. Without it, the directory resolves from the environment as today. The per-area directory options and the model profiles path option are removed. Evidence: two ways to redirect the directory are what let documents disagree today. Need: one redirect for every document. The removal of the old options then follows from D4.
- **Recommendation.** Jev routing becomes an object built over the injected directory, and the launcher and the delegation check receive it as a dependency instead of reading a global. Evidence: routing is the only document with no injection, and that is why tests mutate the environment. Need: tests redirect routing without touching the process environment.
- **Recommendation.** The atomic writer and the plain-record check move out of the MCP configuration module to a neutral agent-directory owner. Configure's copy of the record check is removed. Evidence: they serve five documents, not MCP alone. Need: one owner for each shared rule.

### 5. Tool gate and the child tools' offer

Evidence: the composition root holds the block policy, the codemode steer, the child tools' exposure, a turn hook with an empty body, and the gate's hook. The launcher receives a seated check as an injected function with one production adapter, which repeats a check the root already makes. The launcher redefines the Specialist list that model profiles define. Today `reply_child` is hidden while child session is unseated, and it refuses when called unseated.

- **Mandatory.** While child session is unseated, every parent tool runs, and a cached routing decision is inert. Source: ADR 0009 and the Tool gate invariant. Necessity: consumer contract.
- **Mandatory.** While child session is seated, the gate applies the routing decision for the current user message. With Jev routing off, gated tools run. With it on, Jev's answer applies. After a child launches for that message, gated tools run without asking Jev again. Launch blocked is never kept. Source: ADR 0008, ADR 0009, `docs/specs/routing-owner.md`, and the Tool gate invariant. Necessity: consumer contract.
- **Mandatory.** A reseat or a Jev routing change within one user message reuses the decision already made for that message. Source: the brief's Tool gate scenario. Necessity: approved behavior.
- **Mandatory.** A blocked call from a `codemode` script is also steered to the parent with the block reason, so the script cannot hide it. Source: `docs/specs/routing-owner.md` and the Tool gate invariant. Necessity: consumer contract.
- **Mandatory.** When a legacy spawn package provides the child tools, the harness warns, offers no child tools, and installs no tool gate, even while child session is seated. A legacy package that appears after the first offer leaves that offer and the gate as they were. The warning's text and level do not change. Source: the brief's Legacy spawn package scenario and the Tool gate invariant. Necessity: approved behavior.
- **Mandatory.** Child tools are not registered before child session is first seated. After that, each offer exposes them when child session is seated and hides them when it is unseated. The gate is installed with the first seated offer. Source: D3, because tool exposure is part of the oracle. Necessity: approved behavior.
- **Mandatory.** While any child of the session waits for the parent's answer, `reply_child` is offered and accepts the answer, whether or not child session is seated. When no child waits and child session is unseated, it is hidden again with the other child tools. A reply to a question that is not waiting is still refused. Source: D10, deviation 4, ADR 0009 as amended ("the parent can still answer that child's question"), and the glossary entry Seating. Necessity: approved deviation. The offer therefore also changes on a child's waiting state, not only on seating.
- **Mandatory.** When a legacy spawn package is detected after the first offer, the harness changes no child tool's offer, `reply_child` included. The offer stays as the legacy spawn package scenario leaves it, so the `reply_child` window above does not apply. Source: D10, deviation 4, and the Legacy spawn package scenario. Necessity: approved behavior.
- **Recommendation.** The launcher module owns the gate's block policy, the codemode steer, the gate's hook, and the child tools' offer. Evidence: it already owns the routing decision. Need: ADR 0008's enforcement moves to one owner, as D6 requires, and the root loses the gate.
- **Recommendation.** The turn hook with an empty body and its launcher operation are removed. Evidence: the body is empty. The decision already lasts until the next user message, as ADR 0009 and the routing-owner spec require. Need: no interface without behavior.
- **Recommendation.** The gate reads seating through the Shell's seated predicate, not through an injected function. Evidence: the injected function has one adapter, so its seam is hypothetical. Need: one seated rule.
- **Recommendation.** The gate's decision function keeps its result shape, allow or block with a reason. Evidence: about twenty routing tests use it as their surface. Need: the highest useful existing seam stays the test surface.
- **Recommendation.** The launcher imports the Specialist list from its model profiles owner instead of redefining it. Evidence: two definitions of one list. Need: locality for the Specialist names.

### 6. Child result delivery

Evidence: the child-session core keeps the pending results and the wake rule. The composition root builds the message, flushes before a question, checks idleness, schedules the idle microtask, and subscribes to `turn_end` and `agent_settled`. The core already reports a failed question send with the wording "The question could not reach the parent".

- **Mandatory.** Delivery, including the wake rule, moves into the child-session core. Source: scope item 6 and the brief's out-of-scope exception for the core ("except that delivery moves into it"). Necessity: approved scope.
- **Mandatory.** Delivery follows ADR 0010 sentence by sentence. A completed result with `done`, `pass`, or no Verdict stays pending while any other child of the session is queued, running, or waiting. Any other result, or the last child settling, wakes the parent with every pending result in one message. A consumed result is never delivered again. Source: ADR 0010 and the Child result delivery invariant. Necessity: consumer contract.
- **Mandatory.** Message content and details are byte-identical to today, for both the result message and the question message. Source: the Child result delivery invariant. Necessity: approved behavior.
- **Mandatory.** Delivery does not depend on seating. While child session is unseated, children already launched, queued or running, still start, finish, and deliver. Unseating never loses a pending result. Source: D9, ADR 0009 as amended, ADR 0010, and the glossary entry Seating. Necessity: approved behavior.
- **Mandatory.** A failed delivery keeps the results pending, reports it with today's wording, and is retried at the next boundary. A child question first flushes everything pending, whatever the wake rule says, and the question is still sent when that flush fails. Source: the brief's Delivery scenario and ADR 0010. Necessity: approved behavior.
- **Mandatory.** Delivery happens at a turn boundary, through `turn_end` or when the run settles. An idle parent receives results as soon as they end. The ordering between idle delivery and the turn-boundary flush stays as it is today. Source: ADR 0010 and accepted risk 3. Necessity: the accepted risk is accepted on that condition.
- **Recommendation.** The core receives three things from the root: a send port, an idle check, and a reporter. The root calls one boundary operation on `turn_end` and `agent_settled`. The core decides when to wake, builds the messages, schedules idle delivery, and consumes results only after a send succeeds. The pending-results and wakes-parent queries leave the interface, and the per-record details builder stops being exported. Evidence: the send port has two adapters, Pi's steering message in production and a recording adapter in tests, so it is a real seam. Need: the core's existing test seam, which needs no Pi, covers delivery. Rejected: a pull operation, because it leaves the idle check, the microtask, and the flush order in the root. Rejected: passing Pi to the core, because it couples the core to Pi's event API.
- **Recommendation.** The rule that `done` and `pass` need no reason has one owner, the child projection. The wake rule, the result reason check, and the result card use it. Evidence: the rule is written at three sites today (lens finding L2-4). Need: one statement of a Verdict rule that ADR 0010 and the result schemas share.

### 7. Screen places in the Shell

Evidence: the place map, the seated state, and the place registry live in the Configure module. Two Pi above-editor widgets paint the above-input place: the children box and the todo box. The todo box returns nothing while child session occupies the place, because the children box paints both. Pi moves a widget that is set again to the end, so the todo box can land below Chrome's status row. A claim token always equals "the capability is seated at a declared place". The message stream's paint round trip has one painter.

- **Mandatory.** The Shell owns the seated state and the place map. Source: the glossary entries Shell and Screen place, and ADR 0009 ("Shell is always seated. It owns visual language, screen places, and Chrome"). Necessity: scope item 7.
- **Mandatory.** The place map and the occupant order do not change. Source: ADR 0009 ("The place map is the seating contract") and the brief's out-of-scope list. Necessity: consumer contract.
- **Mandatory.** In the above-input place, each seated occupant renders once per frame, in placement order: child session, then todo. An unseated occupant renders nothing and is not computed. Source: ADR 0009 ("A contribution that is computed and then discarded does not satisfy this decision"), the brief's Above-input scenario, and the Screen places invariant. Necessity: consumer contract.
- **Mandatory.** An above-input occupant does not know which other occupants exist. Source: the brief's problem statement and desired outcome. Necessity: the todo occupant's knowledge of child session is the defect this item removes.
- **Mandatory.** The task box always sits above the status row. Source: deviation 1. Necessity: approved deviation.
- **Mandatory.** The header stays a screen place. Chrome does not read the working count from child session directly. Chrome keeps repainting the header through its current path. The count refreshes while child session is seated, whether or not the children widget renders. Unseating clears it in the same session. Source: D5, ADR 0009 ("Shell does not name the capability"), and the brief's Header scenario. Necessity: approved behavior.
- **Mandatory.** Shell state stays process-global. When two extension instances run in one process, the last one to occupy a place wins. Source: accepted risk 1. Necessity: accepted behavior.
- **Recommendation.** One Shell-owned Pi above-editor widget renders the whole above-input place. It is set on every TUI session start before Chrome's status row and is not installed in other modes. Each occupant gives the Shell one draw function, and a second occupation by the same capability replaces the earlier one. Evidence: one widget makes the order a Shell rule instead of a result of which widget Pi set last. Need: the above-input order and deviation 1 follow from one owner. D3 permits the widget-key and widget-lifecycle assertion changes this requires. This reads ADR 0009's "the children list stays the above-input widget, above the task box" as a screen position, not a Pi widget key (lens finding L3-7). The visual order the ADR names holds.
- **Recommendation.** The header is a single-occupant place. The Shell exposes one header reading and one change signal. The signal fires when child-session state changes and when seating changes. Chrome subscribes to the signal and repaints through its own TUI handles. Evidence: the place map declares one header occupant, so ordering several occupants is a hypothetical seam (lens finding L2-6). Today the change signal comes from the children box, which is why it depends on that widget. Need: the header refreshes whether or not the children widget renders, and unseating clears it in the same session.
- **Mandatory.** At a place that does not combine its occupants into one paint, a capability that only needs to know whether it is seated checks that it is seated at its declared place, and no paint call is required. Those places are the message stream, where each item renders itself, and the overlay, where only one is open at a time. The above-input place still paints its occupants in order. Source: D11, the owner's authorized reading of ADR 0009's "a seated capability is painted through the screen place it declares", with no ADR amendment. Necessity: accepted decision.
- **Recommendation.** One seated predicate per capability and declared place replaces claim tokens. It fails for a place the capability does not declare. The generic registry, its subscription, and the message-stream paint round trip are removed. Evidence: a claim token carries no information beyond the capability and its declared place, and the message stream has one painter, so the round trip always returns that painter's lines. Need: the deletion test, within what D11 permits.
- **Mandatory.** Compact rendering, CodeGraph access, the operator question, and model profiles keep their behavior. They only read seating through the new predicate. Source: the brief's out-of-scope list ("Compact rendering still reads seating from the new owner"). Necessity: approved scope.

### 8. Seating

Evidence: session start and Configure each carry a seating sequence. Session start treats an unreadable or invalid selection as a refusal. The expected-package read for status and doctor treats every failure as "no expected packages". The todo module intercepts tool registration to build its offer. Today's offer order is the operator question, todo, CodeGraph access, compact rendering, then child session.

- **Mandatory.** One seating owner serves session start and Configure. It returns one refusal, and each caller handles it. Session start reports it and keeps the current seating. Configure reports it and does not open the guide. Source: the brief's Seating scenario and the Seating invariant. Necessity: approved behavior.
- **Mandatory.** A ready selection is seated, then every harness capability offers or hides its tools in a fixed order, the order of today. The one exception is `reply_child`, which stays available while any child waits (D10), except that an offer kept by the legacy spawn package scenario stays as it is. An absent selection seats nothing and keeps the current seating. A refused selection reports its reason with today's wording and keeps the current seating. If one capability's offer fails, the later ones are not offered and the new selection stays current. Source: the brief's Seating scenario, the Seating invariant, and D10. Necessity: approved behavior.
- **Mandatory.** Opening Configure checks for the TUI, then reads the selection from disk. An unreadable or invalid selection reports the error and does not open the guide. Otherwise the guide opens from the selection on disk without reseating it. An absent selection opens the guide on the default. Source: ADR 0009 and deviation 3. Necessity: consumer contract and approved deviation.
- **Mandatory.** The Apply plan's seat and unseat lines compare against the selection that is seated now. On a fresh installation with no selection file, nothing is seated, so the first plan lists a seat line for each capability turned on. Source: deviation 3 and ADR 0009 ("Apply shows the plan: which capabilities will be seated or unseated"). Necessity: approved deviation. The fresh-installation effect follows from the approved rule (reverification RV-5).
- **Mandatory.** Confirming saves the selection and, when it changed, the Jev routing choice. It then seats the selection, then applies the companion, MCP, and Pi settings outcome, in today's order. A write failure for the selection or for Jev routing stops before seating, and Pi reports the error as it does today. A saved selection whose routing write failed is seated by the next session. Closing without confirming applies nothing. Source: the brief's Configure scenario and ADR 0009. Necessity: approved behavior. ADR 0009 does not make the order normative, and the brief keeps today's order.
- **Mandatory.** Status and doctor take their expected packages from the same owner's read. A selection that is not present and ready gives no expected packages, as today. Source: D3, because status and doctor output is operator-visible. Necessity: one error contract without a change in output.
- **Recommendation.** The interface is three operations. Read returns absent with the default, ready with the selection, or refused with a reason, and never seats. Seat takes an optional selection, replaces the seated selection when one is given, then runs the offers in list order and awaits each one. A failed offer stops the later ones and fails the seat. Save writes through the atomic writer and fails when the write fails. Evidence: the two current sequences differ only in where the selection comes from. Need: one sequence and one error contract.
- **Recommendation.** The offers are one explicit ordered list that the composition root passes to the seating owner. Todo returns its offer instead of intercepting tool registration. Evidence: the interception exists only to give todo a place in the sequence. Need: adding a capability is a one-line change, and the order is visible in one place. Rejected: each capability subscribing to a seating event, because it makes the order implicit and adds process-global listeners that every test instance would leak into.
- **Recommendation.** The legacy spawn package check runs inside the child-session offer, right before it. Evidence: its warning is the only operator output among the offers, so its position relative to the other offers is not visible. Need: the child-session offer owns its own precondition. Implementation may keep the check before all offers if that is simpler.
- **Recommendation.** The single exposure rule stays: seated means direct, and unseated means hidden. `reply_child` is its only exception, within the D10 window and its legacy exception. Evidence: four callers use it. Need: removing it would copy the rule four times.

## Shared-capability invariants

Implementation and ticket slicing must preserve each invariant. Each one names its source.

- Chrome patching is idempotent, restored only when the session quits, and kept across a reload. A foreign replacement is left untouched. The module-reload marks are unchanged. Source: ADR 0007 as amended, D6, and the brief's invariant table.
- The shared patch owner is part of Chrome, and the source notes stay beside the replacement logic. Source: D8, ADR 0007, and ADR 0009.
- Child result delivery follows ADR 0010 sentence by sentence. Message content and details are byte-identical. Delivery does not depend on seating. Source: ADR 0010, D9, and the brief's invariant table.
- A pending result is never lost to unseating. Children already launched, queued or running, still start, finish, and deliver while child session is unseated. Source: D9 and ADR 0009 as amended.
- The tool gate makes one routing decision per user message and reuses it after a launch. Launch blocked is never kept. The gate is inert while child session is unseated. The `codemode` steer stays. No gate exists while a legacy spawn package provides the child tools. Source: ADR 0008, ADR 0009, `docs/specs/routing-owner.md`, and the brief's invariant table.
- A child question that reached the parent can be answered: `reply_child` stays available while any child waits, whether or not child session is seated, and is hidden again when no child waits and child session is unseated. When a legacy spawn package is detected after the first offer, no child tool's offer changes, `reply_child` included. Source: D10 and deviation 4.
- An occupant of the message stream or the overlay satisfies ADR 0009 by checking that it is seated at its declared place. The above-input place paints its occupants in order. Source: D11.
- Screen places keep the place map and the occupant order. No contribution is computed only to be discarded. Source: ADR 0009 and the brief's invariant table.
- The header stays a screen place, and the Shell does not name the capability. Source: D5 and ADR 0009.
- Seating returns one refusal that each caller handles. An absent selection seats nothing. The offers keep their fixed order. The only tool kept while unseated is `reply_child` for a waiting child, except that an offer kept by the legacy spawn package scenario stays as it is. Source: the brief's invariant table and D10.
- Model profiles refuse to overwrite a document that changed after the editor opened. Source: the brief's invariant table.
- Jev routing is off when absent, unreadable, or invalid, with no report. A change saved by another Pi process takes effect without a restart. Source: ADR 0008, `docs/specs/routing-owner.md`, and the brief's invariant table.
- One injected agent directory redirects every agent document. Each document keeps its own read and wording. Writes go through one atomic writer that keeps the file mode. Source: scope item 4 and the glossary entry Agent directory.
- No C0 or C1 control or bidi control reaches the terminal, except the newline kept in a block. Each renderer keeps its trim, CRLF, and escape-sequence handling. Source: the brief's invariant table.
- The composition root only wires modules and holds no policy. Source: ADR 0003.
- No compatibility layer: obsolete exports and options are removed, not aliased. Source: D4.
- Operator-visible output changes only where a scenario or an approved deviation requires it. Source: D3.
- Every delivery step is independently mergeable and keeps `npm run check` green. Source: D2 and `AGENTS.md`.

## Testing decisions

- Tests cross each owner's interface, not private helpers: the Chrome patch set, the two terminal-safe forms, the agent-directory writer and the injected directory, Jev routing over a temporary directory, the child-session core with a recording send port, the tool gate's decision function and the extension's tool exposure, the Shell's occupants and header reading, and the seating owner. Source: the brief's desired outcome.
- Replace, don't layer. A test that only probed a shallow module is deleted once the owner's suite covers the same behavior. That covers the private-mark patch tests, the Configure module's place tests, and the empty turn-hook test.
- The tests that drive the extension stay as end-to-end coverage. They keep their operator-visible assertions. Only assertions about internal widget keys or widget install and clear calls may change. Source: D3.
- The Chrome patch set has its own suite with throwaway classes. It covers idempotence, a replacing target left alone after a foreign replacement, a wrapping target over a foreign method, a foreign wrapper on top at restore, an inherited method removed on restore, an own method put back on restore, two names on one prototype that never take each other's layer, and the same name recognizing its earlier layer.
- The test that covers restore on quit is kept. It observes, through Chrome's session events, that the patches stay for a reload, a new session, a resume, and a fork, and are restored on quit. It does not read a private mark. Source: the brief's Chrome patching scenario and lens finding L3-1.
- The terminal-safe suite is a table of hostile inputs for both forms: C0, DEL, C1, escape sequences, every bidi control, newline, tab, carriage return, and the empty string. Existing renderer tests pass unchanged, except an operator question test that expects a tab to render as one space. Source: the Terminal-safe text invariant and deviation 2.
- The agent-directory suite covers directory resolution, the atomic write, the kept file mode, a write through a symbolic link, the refusal when the target appeared during a no-replace write, and no temporary file left after a failure.
- No test mutates the process environment to redirect the agent directory, except the directory-resolution test and the Pi sandbox test. A test that passes the directory to a child process through that process's environment is exempt. The routing restart test does so, because the routing-owner spec requires that the choice persists across a new process. The compact rendering test that mutates the variable today moves to the injected directory. Source: the brief's problem statement, `docs/specs/routing-owner.md`, and lens finding L3-6.
- The model profiles change-on-disk tests keep what they assert.
- The child-session core's delivery suite uses a recording send port, a toggled idle check, and the existing fake child factory. It covers each ADR 0010 sentence and each brief Delivery scenario line: results held while a sibling works, a waking result that takes everything pending, one message for many results, a consumed result never sent, a failed send kept pending and reported, a retry at the next boundary, the flush before a question, a question still sent after a failed flush, idle delivery, delivery while child session is unseated, and pending results dropped when the parent session ends.
- The Verdict projection test that imports the per-record details builder moves with delivery. It either crosses the delivery messages or the child projection, so the step that stops exporting the builder keeps `npm run check` green. Source: lens finding L3-5 and D2.
- A Verdict table covers the "needs no reason" rule over every Run state and every Verdict.
- The tool gate keeps its routing tests on the decision function. An extension-level test replaces the empty turn-hook test. It checks that the same user message reuses the decision across a turn start, that a new message asks Jev again, and that a gated tool runs without asking Jev while child session is unseated. The `codemode` steer tests and the legacy spawn package test pass unchanged.
- Extension-level tests cover `reply_child`: offered and answering while a child waits and child session is unseated, hidden again when no child waits and child session is unseated, and unchanged when a legacy spawn package appears after the first offer. Source: D10 and deviation 4.
- The Shell suite covers two occupants rendered in placement order whatever order they occupied in, an unseated occupant not computed, a second occupation replacing the first, an undeclared place refused, the widget installed only in the TUI, the header reading at zero while child session is unseated, and the header signal on seating changes. The existing widget-order test remains the oracle for "the children box above the task box above the status row". A new test covers deviation 1: with child session unseated, a task that arrives mid-session renders above the status row.
- The seating suite uses a temporary agent directory and recording offers. It covers that reading never seats, that absent seats nothing, that refusals keep their texts, that a selection is current before the first offer runs, that offers run in order and are awaited, that a failed offer stops the later ones and keeps the new selection current, and that a save round-trips through a read.
- Extension-level Configure tests cover deviation 3: closing without confirming changes nothing, the guide opens from disk, the plan compares against the seated selection, and a write failure on confirm stops before seating.
- `npm run check` is the only gate. It also runs type checking and an unused-export check, so a step that stops exporting a symbol also changes the tests that import it. Source: `AGENTS.md` and `docs/agents/quality.md`.

## Out of scope

- Modules that are already deep: the companion workflow, the model profile editor flow, the child-session core's launch queue, stall watch, running limit, and `ask_parent`, CodeGraph access adapters, and the MCP and Pi settings plan and apply logic. Delivery moves into the child-session core as the one exception.
- Command names, message types, file names, schema versions, the companion catalog, the place map, and the occupant order.
- A new harness capability, a Pi version guard for patches, todo render coalescing, the fixed header, child bash, and compact rendering's behavior. Compact rendering still reads seating from the new owner.
- Moving the notify-or-stderr report helper.
- A shared read helper for agent documents.

## Prototype

None. No functional question is open that an artifact would resolve. The tests that drive the extension act as the oracle.

## Approved deviations

Approved by the owner. Each one is visible only in the edge case named here.

1. The task box always sits above the status row. Today it can land below the status row when child session is unseated and the first task arrives mid-session.
2. A tab in operator question text renders as three spaces instead of one, as in the child views and the result card.
3. Opening `/workflow:config` no longer reseats the selection from disk, so closing it without confirming changes nothing. The guide opens from the selection on disk, and the Apply plan's seat and unseat lines compare against the selection that is seated now. ADR 0009 says closing applies nothing, and Apply shows which capabilities will be seated or unseated.
4. While a child waits for the parent's answer and child session is unseated, `reply_child` stays available, so the parent can answer. Today it is hidden, and the delivered question cannot be answered. When a legacy spawn package is detected after the first offer, the harness changes no child tool's offer, `reply_child` included, as in the legacy spawn package scenario.

## Accepted risks

- Shell state is process-global, as it is today. When two extension instances run in one process, the last one to occupy a place wins.
- Removing extension-level options breaks any external caller that passed them. None is known.
- Delivery timing moves into the child-session core. Idle delivery and the turn-boundary flush must keep today's ordering.

## Dependencies and native relationships

External dependencies:

- The Pi peer range declared in `package.json`.
- Pi's above-editor widget order. A widget that is set again moves to the end, so the order follows which widget is set last on each session start. The Shell's above-input widget must be set before Chrome's status row on every session start.
- Pi's `turn_end`, `agent_settled`, and `session_shutdown` events, and its idle check.
- Pi's steering messages that trigger a turn.
- The `tool_call` event's parent tool call, which carries the `codemode` steer.
- Pi activates a tool that is registered again with a new exposure during a session. Deviation 4 relies on it. Verified against Pi 1.0.3.

Native relationships between modules. Ticket slicing must respect each one. They constrain order and interfaces. They do not define slices.

- Seating (8) writes the seated state that the Shell (7) owns. Every reader of seating reads it through the Shell's predicate. Until both land, the seated state keeps exactly one owner.
- Seating (8) reads and saves the selection through the agent directory (4) and its atomic writer.
- Seating (8) runs the child-session offer that the tool gate owner (5) provides and the todo offer that todo returns. The offer order lives only in the seating owner's list.
- The tool gate (5) reads seating through the Shell's predicate (7) and reads Jev routing through the injection that the agent directory (4) provides.
- `reply_child`'s availability (5) depends on the child-session core's waiting state and its subscription (6). It does not depend on delivery's wake rule. The legacy spawn package check in the child offer (5, 8) overrides it after the first offer.
- Delivery (6) depends on no seating state. It shares the "needs no reason" Verdict rule with the result card through the child projection.
- The header reading (7) depends on the child-session core's subscription. Chrome (1) consumes the Shell's header reading and signal and does not name child session.
- The theme read (1) and the Visual language primitives (3) share the Visual language owner. The first change that needs it creates it.
- Chrome (1, 3) must not depend on any capability module after items 3 and 7 land.
- Terminal-safe text (2) has no interface dependency. It touches renderers that items 1, 3, 6, and 7 also edit.
- The tool gate (5), delivery (6), the Shell (7), and seating (8) each remove policy from the composition root. Each keeps the root wiring-only for its own rule.
- Compact rendering, CodeGraph access, the operator question, and model profiles depend on the Shell's seated predicate (7) and keep their behavior.

## Feature review

Final verdict: READY. The reverification of the D10 legacy exception and D11 found no blocker and no warning. The consolidated report is `docs/specs/deep-harness-modules-review.md`. It covers the current package and review handoff. No warning is left undisposed, and the owner explicitly accepted each risk. The ADR 0007 and ADR 0009 amendments name this specification's path, so they are published in the same change as this specification.
