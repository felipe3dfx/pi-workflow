# Feature brief: child-session delegation

Status: user-confirmed. Prototype disposition: reference-only. This brief is not an implementation base.

The non-UI decisions remain in `docs/specs/child-session-delegation.md`. The operator surfaces below replace that spec's operator-surface section. That replacement is a functional change and is not yet folded into the published spec.

## Operator surfaces

The operator sees the children of the current session in Pi's header, above the chat. The lists are not transcript lines. The header reads `Subagents` and the count. An empty list is omitted. Each row shows the name, the current step, the model, the effort, and the elapsed time. The active row is highlighted. Effort also appears on the session input.

`[↗]` opens that child's detail inside the TUI. Thinking in that detail can be collapsed. `[x]` on the list cancels that child. A cancelled child stays visible without `[↗]`. In the detail, `[x]` closes the viewer and does not cancel. `Ctrl+x` cancels the child. `q` or `Esc` also closes the detail. A click works in fullscreen. Every click also has a key, because regular mode leaves the mouse to the terminal. Pi renders these lists with `setHeader`. That placement is not a proven scroll pin.

Session tasks are not children. They appear in that same header, below the subagent list. The chat starts after the header. The list sits in a box with bracket corners outside the text column, space above and below, and a `×` that collapses it. A pending row is highlighted. A done row uses a green check. `h` hides or shows done tasks. The line near the input counts running children, not tasks. The tool can write the whole list, add one task, update one task, clear the list, or list it. It does not create a feature document.

A question panel replaces the input. The transcript stays above it. The header says how many questions are waiting, plus the elapsed time and the token count. Options are numbered, with a radio and a description on the right. The active option is highlighted across the row. `z` is the free-text row. `Tab` moves to the next answer. `Esc` scrolls the transcript and leaves the question panel open. It is not a refusal. `Shift+x` dismisses the panel and the asking tool receives a refusal. It does not invent an answer. Answering does not launch a child. Print mode refuses the panel the same way.

A closed tool or thought is one short line. Opening it shows the body under that title. A thick left bar encloses both the title and the body. `Enter` opens it. Left arrow or `Ctrl+e` closes it. Opening it does not change the file or the tool result.

## Prototype

Evidence: `prototype/child-session-operator/`. Disposition: reference-only. Approved pages: list, detail, todos, question, expanded tool or thought.
