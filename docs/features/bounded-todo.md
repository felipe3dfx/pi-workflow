# Bounded Todo — feature brief

Status: approved definition, READY WITH WARNINGS; not implemented. Definition package: `bounded-todo/definition-1`. Parent: https://github.com/felipe3dfx/pi-workflow/issues/364. Companions: [feature review](bounded-todo-review.md), [specification](../specs/bounded-todo.md), and [specification review](../specs/bounded-todo-review.md).

## Need and outcome

A long Todo can displace the conversation; the issue's [screenshot](https://github.com/user-attachments/assets/447f6ac9-d000-416e-8604-6f607bd7e084) illustrates it. The existing hide-done shortcut is undiscoverable and cannot bound a long pending list. An operator needs bounded Todo height, access to every task, and discoverable clickable controls with keyboard alternatives.

## Confirmed scope

The user confirmed a Todo-only limit of one third of terminal height including chrome, at most eight tasks per adaptive page, pagination and an existing show-done filter surfaced as All / Without done. Keep original order; changing the filter returns to page one; state changes do not follow the working task and an invalid page clamps to the last. Controls remain available when filtering reduces a qualifying unfiltered list. In insufficient space use a temporary one-line compact summary, preserving page, filter and manual collapse selection; shortcuts still work. Clicking × collapses without deleting tasks; clicking the manually collapsed line reopens, or shows the automatic summary if space remains insufficient. Fullscreen clicks and keyboard access, including outside fullscreen, are in scope. The detailed derived rules are in the [specification](../specs/bounded-todo.md).

User approvals, in order: [controls](https://github.com/felipe3dfx/pi-workflow/issues/364#issuecomment-6852306432), [page size](https://github.com/felipe3dfx/pi-workflow/issues/364#issuecomment-6852318377), [filter](https://github.com/felipe3dfx/pi-workflow/issues/364#issuecomment-6852330205), [order and page](https://github.com/felipe3dfx/pi-workflow/issues/364#issuecomment-6852346139), [height](https://github.com/felipe3dfx/pi-workflow/issues/364#issuecomment-6852364441), [consolidation](https://github.com/felipe3dfx/pi-workflow/issues/364#issuecomment-6852379238), [compact](https://github.com/felipe3dfx/pi-workflow/issues/364#issuecomment-6853056007), [risk](https://github.com/felipe3dfx/pi-workflow/issues/364#issuecomment-6853940782), [collapse](https://github.com/felipe3dfx/pi-workflow/issues/364#issuecomment-6853979762), [reopen](https://github.com/felipe3dfx/pi-workflow/issues/364#issuecomment-6854244643). Later interaction approvals supplement the consolidation; no product question remains.

## Boundaries and evidence

No per-state filters, shared panel budget, task mutation from clicks, new persistence, or host patch is proposed. The user expressly accepted that Todo and a working child-session panel together can still clip conversation or controls; validate that scenario. The existing Todo, Shell and child-session interfaces must remain compatible. There is no prototype or prototype UI contract; none is required. GLOSSARY.md supplies canonical Todo and Task state; no Domain Authority Handoff was supplied, an admissible evidence gap with semantics closed. ADR 0007 prefers public widget APIs; no new ADR is needed for this existing screen place.

Investigation at `0488201d49738a06f9527d97d89580461f5d42eb` on branch 363 is evidence only, not a delivery-base selection. Public Pi 1.4 source and local 1.5.0 source support the mechanism; installed 1.5.2 integration, real-terminal interaction and implementation are not verified. An earlier `npm run check` timed out at 180s and is incomplete, not validation. No implementation is claimed; tracker state is authoritative.
