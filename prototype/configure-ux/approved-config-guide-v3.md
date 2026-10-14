# Approved prototype: workflow config guide v3

Disposition: reference-only. The user approved this contract on 2026-10-14. It supersedes v2: the second feature-review reverted the catalog-error screen (F6), because a catalog load error already refuses `/workflow:config` before the guide opens. It is evidence, not an implementation base. Evidence: `snapshots.txt`, produced by `snapshots.mjs`; interactive run with `pi -e prototype/configure-ux/extension.ts` and `/proto:config [fresh|mixed]`.

## Question and success criterion

Can the operator tell a toggle from a choice without reading help, know how many changes are pending, and understand what happens before confirming, without losing any configuration capability?

## Confirmed

- The guide stays one overlay list, as ADR 0009 requires; it is not a wizard.
- The list has three titled sections: Capabilities, Routing and delegation, Companions. A rule and the `Review and apply` action close the list.
- A toggle shows `[x]` or `[ ]` before its label. Space or Enter flips it.
- A choice shows `‹ value ›` at the right. ←/→ change it; Space or Enter advance it.
- The action row ends with `›`. Enter opens the review.
- A changed row ends with `•`. The title and the action show the count: `no changes`, `1 change`, `N changes`.
- Every row has its own description under the list. A companion uses its catalog description plus "Off stops expecting it; it is never uninstalled."
- A companion row shows its status: `installed`, `will install`, `not installed`, `installed · kept`, or `unreadable`.
- Choosing `orchestrator` while Child session is off shows an informational warning. It does not refuse the choice.
- Hints follow the focused control type. Tab moves the focus to `Review and apply`.
- The review lists Changes as `from → to`, or "No changes to your selection."; Packages with `+` install, `!` unreadable with a pointer to `/workflow:doctor`, `=` kept installed; and Always on apply: align MCP servers, apply default Pi settings, nothing is uninstalled.
- In the review, Enter applies. Esc returns to editing with focus on `Review and apply` and the draft intact.
- When the review does not fit the terminal, its body scrolls with ↑/↓ and the wheel and shows `↑`/`↓ more`; `Apply now` and the hints stay visible.
- A companion row shows `! unreadable` in the review only while it is still expected; an unreadable companion that is not expected is not a degraded harness.
- Mouse keeps parity with today: the wheel moves the focus (or scrolls the review), a click on a row flips the toggle or advances the choice, a click on `Review and apply` opens the review, and a click on `Apply now` applies. A click on `[×]` behaves like Esc, including the discard confirmation and the return from the review.
- Without pending changes, Esc closes. With pending changes, the first Esc asks to discard and a second Esc closes without writing anything; any other key keeps editing.

## Not covered

- A companion catalog load error: `/workflow:config` keeps reporting it and does not open the guide, as today.
- Real seating, companion state resolution, and apply effects; `mocks.ts` replaces `seating.read()`, `resolveCompanionStates()`, and the Jev routing and Delegation mode reads.
