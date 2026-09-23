# Approved prototype: Pi header cases v1

Disposition: reference-only. The user confirmed this page on 2026-09-23. It is evidence, not an implementation base.

## Confirmed

- Subagent and todo lists render in Pi's header, above the chat. They are not transcript lines.
- Subagents come first. Todos sit below them in the bracket box.
- An empty list is omitted. An empty header shows neither list.
- The todo box can be collapsed with `×`.
- A cancelled child stays visible without `[↗]`.
- This uses `setHeader`. It does not rewrite the transcript and was not proven as a scroll pin.
