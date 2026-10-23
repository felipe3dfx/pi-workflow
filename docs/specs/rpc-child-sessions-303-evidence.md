# #303 implementation evidence

## Scope and environment

- Ticket: #303, "Admit concurrent writers with disjoint surfaces"; branch `303`, based on `296-rpc-children`.
- Specification: `docs/specs/rpc-child-sessions.md`, sections 4.8 and 7.4.
- Host: Linux, Node v26. No macOS run was made.

## What changed

- `extensions/write-claims.ts`: pure module with `createWriteClaims` (`claim`, `release`, `conflicts`, `rebuild`), `surfacesOverlap` and `conflictReason`. Entries are compared case-insensitively on every filesystem; absolute, `~`, drive, `..`, bracket, extglob, backslash and unbalanced-brace entries overlap everything; no declared surface claims the whole checkout.
- `spawn_child` takes an optional `surfaces` list. It travels in `LaunchRequest` and the ready plan (`extensions/child-launcher.ts`).
- `createChildSessions.start` takes the claim for a `worker` before the factory runs and before the child is queued, keyed by the new child id and compared only within `plan.worktree`. A refusal names the conflicting child and entries. The claim is released when the launch does not end queued (refusal, error, foreground completion) and in `finish` for completion, failure, cancellation and timeout. `disposeAll` clears every claim. `continue_child` goes through `start` and claims again.
- ADR 0020 checkpoint grant conditions and parent writes are untouched.

## Scenario evidence

| Scenario | Proof | Output excerpt |
| --- | --- | --- |
| Overlap, uninterpretable entries, case, release, rebuild (unit) | `test/write-claims.test.mjs` | `✔ entries that cannot be interpreted overlap everything` |
| Disjoint writers both run; overlapping third refused with the conflict; runs after the first ends | `test/child-write-claims.test.mjs`, `test/child-sessions.test.mjs` "spawn_child admits writers with disjoint surfaces ..." | `✔ spawn_child admits writers with disjoint surfaces and refuses an overlap naming the entries until the first ends` |
| No surfaces claims the whole checkout | `test/child-write-claims.test.mjs` "a writer without surfaces conflicts with any other writer" | `✔ a writer without surfaces conflicts with any other writer` |
| Read-only roles claim nothing; other worktree does not conflict | `test/child-write-claims.test.mjs` "read-only roles claim nothing ..." | `✔ read-only roles claim nothing and are never refused` |
| Claim held while queued | `test/child-write-claims.test.mjs` "a queued writer holds its claim before it runs" | `✔ a queued writer holds its claim before it runs` |
| Completion, cancellation, failure release; foreground holds then releases | same file | `✔ failure, cancellation and completion release the claim` |
| `continue_child` claims again | same file | `✔ continue_child claims again and is refused on overlap` |

Existing tests that launch several workers in one worktree now declare disjoint surfaces through their launch helpers.

## Quality gate

`npm run check`: exit 0, tests 1280, pass 1265, fail 0, skipped 15, wall clock 20.3 s.

## Open gaps

- Reconstruction of claims after `/reload` is #302; `rebuild` exists and is unit-tested but nothing calls it on reload.
- Admission for the parent's own writes is out of scope.
- The write surface and claim terms are not yet in GLOSSARY.md.
- No macOS evidence was produced on this Linux host.
