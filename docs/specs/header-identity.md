# Chrome header with subtle identity

Status: SPECIFIED (#243).

Package: `header-identity/definition-1`, the approved brief `docs/features/header-identity.md` (v6).
Review handoff: `header-identity/feature-review-1`, `docs/features/header-identity-review.md`, verdict `READY`.
Consolidated report: `docs/specs/header-identity-review.md`.
Prototype: none.

## Problem

The Chrome header shows the branch, the cwd, the working children, and the context usage as `used / window`. It has no identity, and the operator must do mental arithmetic to know how full the context is.

## Solution

The header stays one line and gains a brand on the left and a context meter on the right, inspired by gentle-shell, without new data sources:

```
π-workflow · ~/D/repos/pi-workflow · main          ◆ 2 · ctx ▰▰▰▰▱▱▱▱ 50% · 200K
```

When the line does not fit, it degrades by priority: the brand goes first, then the bar, then the cwd is truncated from its start. The branch, the working count, the percentage, and the window stay visible while they fit.

## User stories

1. As the operator, I want a `π-workflow` brand at the start of the header, so that the session has a recognizable identity.
2. As the operator, I want the cwd before the branch, so that the stable location anchors the line.
3. As the operator, I want an 8-cell bar and a percentage for context usage, so that I read how full the context is at a glance.
4. As the operator, I want the context window size beside the percentage, so that I know the scale without the used token count.
5. As the operator, I want the bar and percentage colored by today's thresholds, so that warnings look as they do now.
6. As the operator, I want an overflowing context shown with its real percentage, so that an overflow is never hidden.
7. As the operator, I want `ctx ?` with the window when usage is unknown, so that I know the window and that usage is pending.
8. As the operator, I want the header to drop decoration before information on a narrow terminal, so that the branch, working count, percentage, and window stay visible while they fit.
9. As the operator, I want a truncated cwd to keep its end, so that I still see the repository name.
10. As the operator, I want the header never to overflow its line, so that the Chrome layout never breaks.

## Implementation decisions

Every decision below was resolved by the developer during the definition session of 2026-10-14 (status: accepted) and is mandatory unless labeled a recommendation. Source: the brief and the feature-review report.

### Layout

- One line. The left side is the brand `π-workflow` in `accent` without bold, the shortened cwd in `text`, and the branch in `dim`, in that order, joined by `·` in `borderAccent`. An absent branch leaves no separator.
- The right side is the working count `◆ N` in `accent` when children are working, then the context block, joined by `·` in `borderAccent`.
- The context block is `ctx`, the bar, the percentage, and the window, the window in `dim` and formatted by the existing compact context-token format. The used token count is not shown. This supersedes today's `used / window`.
- The `·` separator is a header-only divergence; the footer keeps `│`. Source: review finding 7.
- The cwd keeps today's shortening (the last two segments whole). Source: review finding 9.

### Numbers

- Percentage: `round(tokens / window × 100)`, uncapped.
- Filled cells: `round(percentage / 100 × 8)`, clamped to 0..8; filled `▰`, empty `▱`.
- The bar and the percentage take today's usage color for that percentage: `warning` from 75, `error` from 95.

### Partial data

- Unknown tokens with a positive window: `ctx ? · <window>` in `dim`, without a bar.
- A zero or missing window: no context block. The working count still shows.
- No context block and no working children: no right side, and the left side gets the whole room.

### Width degradation

- The room is the width minus the `marginFor` margins on both sides, as today.
- Steps apply in order, each only while the full line does not fit the room: drop the brand; drop the bar, leaving `ctx <pct>% · <window>`; truncate the cwd from its start, keeping its end, with a leading `…`.
- The branch, the working count, the percentage, and the window are guaranteed only while they fit the room. Below that, the whole line is truncated as today and never exceeds the width. Source: review finding 1.

### Structure

- Mandatory: `renderHeader` keeps its interface (`theme`, `HeaderData`, `width`) and returns one indented line; `HeaderData`, the header slot, and its fixed placement do not change. Reason: the brief adds no data source and limits scope to the header.
- Mandatory: the header stops using the shared `spread` helper, which truncates the left side as a whole and would cut the branch before the cwd. Source: review, transversal coherence.
- Recommendation: build the layout inside `chrome.ts` beside `renderHeader`, with the header's own small helpers for the meter and the cwd truncation; keep them private unless a test needs them, since `renderHeader` is the test surface. `truncateToWidth` accepts an ellipsis argument, which the cwd truncation can reuse by reversing direction or by measuring the kept end.

### Shared-capability invariants

- Usage color thresholds, compact context-token format, `marginFor` margins, `terminalSafeLine` sanitizing of the branch and cwd, and the fixed header slot are unchanged.
- The footer, the status row, the input editor, and the working count source are unchanged.

## Testing decisions

- Seam: `renderHeader` with the existing test theme, asserting the plain lines and their `visibleWidth`, as `test/chrome.test.mjs` does today. Tests observe the rendered line only.
- Cases: full layout with and without working children and branch; the percentage and bar at 0, a rounding boundary, 75, 95, and above 100; unknown tokens; zero window; each degradation step at the width where it first applies; cwd truncation keeping its end with `…`; widths down to 1 never overflowing.
- The glyphs `π`, `▰`, and `▱` are covered by width assertions with `visibleWidth`.
- The existing header assertions for the old order and `used / window` are replaced; the `shortenPath` and fixed header tests pass unchanged.
- Prior art: `test/chrome.test.mjs`, `test/fixed-header.test.mjs`.

## Out of scope

- Cost, weekly usage, provider, model, and shortcuts in the header.
- A rule under the header.
- An ASCII fallback for the glyphs.
- Changes to the footer separator or other Chrome surfaces.

## Further notes

- Accepted risk: `π`, `▰`, and `▱` may render with an unexpected width in some fonts. Mitigation: width assertions and a visual check by the developer before closing.
- Evidence gap: no Domain Authority Handoff; `GLOSSARY.md` (Chrome, Place) is the root authority, and the change introduces no new domain term.
- ADR 0007 (patching pi-tui internals for Chrome) is unaffected: the header uses the public `setHeader` slot.
