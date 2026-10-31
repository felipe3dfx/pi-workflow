# ADR 0026: Fleet transcript residency per item

## Status

Acceptance: approval and merge of the introducing PR.

## Context

The Fleet view reads a child's audit transcript in bounded windows of observations. The audit records one observation per message delta and one per tool update, and an item renders differently depending on which of its observations are resident: a partial message can draw about 255 rows and the same message ended about 2,700. When residency was counted in raw observations, loading or pruning a window changed what was on screen, so any window rule could undo itself. Three window designs failed independent verification on realistic transcripts: pinning the visible keys, trial removal of windows, and a range around a cursor that skipped item interiors. They produced load and prune loops, unbounded retention with parallel tools, a pane stuck while scrolling down a long ended message, and a half-filled pane next to long compact items.

## Decision

Issue: #322.

The audit transcript is still read in pages of the window size, but windows are not retained. Each page is folded on arrival into one entry per item, which keeps only the observations that define how the item renders:

- an ended message, its end;
- a running tool call, its start and its latest update; an ended one, its start and its end;
- a message without an end, its deltas joined, capped at 32 KiB of text.

The kept deltas of a message stay contiguous. A page read backward, a page that reaches the end of the audit transcript, and any page read while the view follows keep the newest 32 KiB: older text is dropped and older deltas are refused afterwards. Any other page read forward keeps the oldest 32 KiB: it never drops held text and refuses later deltas, until the message's end replaces them or a later page that keeps the newest text starts again from its newest delta. A page counts as reaching the end only when the audit reports how much of it is written.

An item renders only from the defining observations it has seen, never from which pages are resident. A load adds rows above or below the viewport and a prune removes rows outside it, so neither moves what is on screen, except in the cases listed under Consequences. When a message whose start is not shown, because it was cut or not loaded yet, ends while the operator reads it, the view keeps its distance from the message's end. A scroll that runs past the rows loaded above it continues by the remaining rows once they load.

Residency is bounded at 384 items. Pruning removes whole items from the end farther from the viewport and never an item within one pane height of it. When that is not enough, ended items that draw no rows are removed from between the two ends, since nothing reads them again and they change nothing on screen.

## Consequences

- Retention is bounded by items and by the text cap, whatever a tool or message streams.
- A message longer than 32 KiB that is streaming, or that was read from the end backward, shows its last 32 KiB under the earlier-evidence marker. Its start is read with Ctrl+O, not by scrolling.
- Scrolling down into an ended message whose end is not loaded yet shows a stable prefix until its end page arrives, including in a reopened record that was never closed.
- A message longer than 32 KiB that never ended and is reached by scrolling down from above shows its first 32 KiB with no sign that more follows.
- While a message past the cap keeps streaming, text dropped from its front shifts its interior if the operator is reading it.
- A backward page can still move rows on screen in two cases:
  - it prepends text to a paragraph taller than the pane, or to text across a code fence, and the paragraph wraps again;
  - items whose observations interleave, such as parallel tools, can reorder or grow by a few rows below the anchor.
- When a message whose start is not shown ends, the view keeps its distance from the end it had before that read. Deltas folded in the same read as the end, usually a few rows, move it by their rows.
- Passing a tool with thousands of updates reads every page in between; no item interior is skipped. Pages of items that draw no rows add few rows, so one step can read dozens of pages.
