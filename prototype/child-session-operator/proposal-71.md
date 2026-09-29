# Proposal #71: pinned subagent box, full-screen view, live detail

Status: pending Owner approval. Disposition: reference-only. This file does not change any `approved-*.md` record.
Pages: `07-caja-fija.html`, `08-vista.html`, `09-detalle.html`.

## vs `approved-header-v1.md` (page 07)

- Placement moves from `setHeader` above the chat to a Pi widget pinned just above the input (`aboveEditor`).
  It stays in view when the transcript scrolls.
- Subagents still come first. The todo bracket box sits below the subagent box, next to the input.
- Unchanged: title `Subagents` plus the count, the active row highlighted, and an empty list omitted.
- Rows show a state glyph: `○` queued, `◐` running, `?` waiting, `✓` completed, `✗` failed, `–` cancelled, `⧖` timed out.
- Finished rows stay for 60 s, at most 3. The box shows up to 8 rows plus `… N more`.
- The box refreshes on each state change, and every second only while a child is working.
- A cancelled child is no longer defined by the missing `[↗]`, because no row has buttons.

## vs `approved-list-v1.md` (pages 07 and 08)

- The list no longer lives in the transcript. It lives in the pinned box.
- Unchanged: each row shows the name, the current step, the model, the effort, and the elapsed time.
- `[↗]` and `[x]` are removed from rows, because the box cannot receive keys. The box shows the hint `alt+a view`.
- Session effort appears in Pi's footer as `model • high`, not as `Grok 4.7 (high)` on the input.
- The separate "N children still running" line near the input is dropped. The box count covers it.
- A full-screen view, opened by `alt+a` or `/pi-workflow-children`, lists every child, including finished ones.
  It uses the keys `j/k move · Enter detail · s/c cancel · q close`.
- Cancel asks `Cancel <name>? y/n` for a running or waiting child. A queued child is cancelled without a confirmation.
  A finished child cannot be cancelled.

## vs `approved-detail-v1.md` (page 09)

- The detail opens with `Enter` from the full-screen view, not from `[↗]`.
- The header names the child, its model and effort, the state, and the elapsed time. `[x]` is removed.
- The thread shows text, tool calls, and thinking, and follows the tail live.
- Thinking is collapsed with Pi's thinking toggle, `ctrl+t thinking`, instead of `Ctrl+e`.
- `Esc` goes back to the list, and `q` closes the view. Previously both returned to the list.
- `s`/`c` cancels with the same confirmation, instead of `Ctrl+x`.
- Every state can be opened, including cancelled. Only the cancel key is hidden for finished children.

## Unchanged

Todos (`approved-todos-v1.md`), operator questions (`approved-questions-v1.md`), and expanded tools
(`approved-tools-v1.md`).
