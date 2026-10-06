# ADR 0009: Guided configure replaces setup

## Status

Acceptance: approval and merge of the introducing PR.

Superseded by ADR 0012 for the command name and argumentless-command clauses.

Amended by the deep harness modules feature (`docs/specs/deep-harness-modules.md`) to clarify what unseating stops.

## Decision

`/workflow:configure` replaces `/workflow:setup`. The command is the operator's guided confirmation, for the current session, of which harness capabilities are seated and which companion catalog entries are expected. It takes no arguments.

The guide is one overlay list, not a wizard. It offers each harness capability on or off, then each current catalog expectation on or off, then Apply. Apply shows the plan: which capabilities will be seated or unseated, which missing expected companions will be installed, which installed packages will be left installed, that nothing is uninstalled, and that MCP servers and default settings will be aligned. Confirm apply applies that plan. Closing the list without Confirm apply, including Esc, writes nothing, applies nothing, and reports no error.

Without a TUI, or with any argument, the command reports the error and applies nothing. An absent selection file opens the guide on the default: every harness capability on, and every current catalog entry expected. Nothing is written or applied until Confirm apply. An unreadable selection, or an invalid one, reports the error, does not open the guide, does not write, and does not apply. Invalid means the text is not JSON, `schemaVersion` is not 1, a harness capability is missing, a value is not boolean, or the expectation for a package in the current catalog is missing. A catalog that gained a package makes an older file invalid because that expectation is missing. Configure does not overwrite a refused file. The operator recovers by deleting the file, so the next open uses the absent-file default, or by fixing the file outside the command.

One module applies the selection. It does not split `installMissing` into a new installer module. ADR 0004 stands. The command is the adapter. A skill does not guide or apply it. A separate binary does not guide or apply it.

The versioned companion catalog lists what can be expected. It is not the user switch. Local selection records which companion catalog entries are expected and which harness capabilities are seated. Configure seats or unseats child session, todo, operator question, model profile, CodeGraph access, and compact rendering. Status and doctor are not switches. They show a gap and do not install anything.

Shell is always seated. It owns visual language, screen places, and Chrome. Chrome's patches stay in the Chrome module. A seated capability is painted through the screen place it declares. Shell does not name the capability. A contribution that is computed and then discarded does not satisfy this decision. Unseating a capability removes it from those places in the same session and stops its behavior. It starts no new work: work it already accepted, such as a launched child, still finishes, and the parent can still answer that child's question.

The place map is the seating contract. It does not move the surfaces the child-session specification already placed, except that the operator question moves to the overlay. The children list stays the above-input widget, above the task box. Child session also occupies the Pi header, the message stream, and the overlay. Todo stays the above-input task box, below the children widget. The header that reads `Subagents` and the count is the children widget's header, not the Pi header. Effort on Pi's footer stays. The footer is outside the four screen places, and this map does not remove that effort. CodeGraph access on the message stream means its tool results appear in the stream while it is seated, and it adds no painter. While CodeGraph access is unseated, the tool does not act. The model-profile overlay stays compatible with the `/workflow:models` modal. Only one overlay is open at a time, and opening the operator question closes the children view. The operator question does not replace the input. This decision supersedes two sentences of the child-session specification: the children view closes when a non-overlay such as the question panel takes focus, and a question panel replaces the input.

On Confirm apply, one outcome set is applied: the selection is recorded, capabilities are seated or unseated, missing expected companions are installed, the MCP server catalog is aligned, and default settings are applied. The order inside that set is not normative, and there is no second transaction. A failed companion install does not roll the set back and does not skip MCP alignment or default settings. The failed companion leaves a degraded harness. Turning an expectation off does not uninstall the package and does not make a degraded harness. A colliding package is warned and never removed. Turning compact rendering off restores Pi's seven built-in tools in the same session and keeps the session working directory and settings.

While child session is seated, the tool gate and the launcher share the one verdict the current chooser already produced for that operator message. The verdict is that chooser's answer and may already be a skill judgment. This feature does not add or remove skill-name routing, and it does not adopt ADR 0008. Who chooses stay or leave stays outside this feature. The verdict survives the start of the next model turn until the next operator message. A stay verdict lets the parent tools run. Unseating child session makes the tool gate inert, including a cached verdict.

Supersedes: ADR-0001, only the clause that mutation requires `/workflow:setup`. Explicit mutation remains. Startup, status, and doctor still must not install anything.

## Considered Options

- Keep `/workflow:setup` as an argument-less install of every catalog entry.
- Let an agent skill guide and apply the selection.
- Ship a separate installer binary, or add public flags beside the guide.
- Treat a missing selection file as an error, or report an error when the list closes without Confirm apply.
- Make confirmation order normative, so seating before install would violate the decision.
- Skip MCP alignment and default settings when a companion install fails.
- Adopt ADR 0008 here, or remove skill-name routing in this feature.
- Move the children list, the task box, or footer effort to match the place map.

## Consequences

Code that still registers `/workflow:setup` does not follow this decision until a later change. A missing or unreadable expected companion remains a degraded harness. A catalog entry that is not expected is not a degraded harness. Tests of apply call the module, not the guide. Restoring a capability that turns off, including compact rendering and the child-session tool gate, happens on confirmation, not only on session shutdown. Skipping MCP alignment or default settings after a failed install does not follow this decision. Applying the outcome set in any order, including seating before install, follows this decision. Clearing the shared verdict at model-turn start does not follow this decision.
