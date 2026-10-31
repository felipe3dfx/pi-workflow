# Minor consultation follow-ups after #316: #318 evidence

Issue: [#318](https://github.com/felipe3dfx/pi-workflow/issues/318). Working branch: `318`; base: `d16d732` (`main`). Sources: review of #316, #315, ADR 0025.

| Follow-up | Outcome | Evidence |
| --- | --- | --- |
| Wrapped consultation replies | Discarded. | See below. |
| Esc in the Fleet decision step | Resolved: Esc returns to editing with the typed text and cursor intact; a mouse click cannot switch children while the decision is open. | `test/child-sessions.test.mjs`, "Esc in the Fleet decision step returns to editing with the typed answer intact" and "a click on another child during the Fleet decision step keeps the decision". |
| Classified decision types | Resolved: `interpret()` and `assess()` return classified kinds only, the overload is gone, and the write-only `pending` map and the unread `installActionAuthorization` return value are removed. | Type-only and unread-state changes, so no runtime behavior to test: `npx tsc --noEmit` and the existing authorization suites pass; adjudication binding renewed after an independent check (below). |
| Duplicated question parser | Resolved: `integrated.mjs` and `parent-host.mjs` use `consultationQuestion()` exported by `extensions/child-runtime.ts`. | `test/child-runtime.test.mjs`, "a consultation question reads back its ref, action, reason and effects". |

## Wrapped consultation replies

A parent model answers a consultation through `reply_child`, which since #315 run 3 validates the reply with `consultationAnswer()` before delivery. A fenced or prefixed reply is refused as a tool error the parent can correct; it never reaches `answered()` and is never retained silently (`test/child-sessions.test.mjs`, "reply_child refuses a consultation reply the child would reject and keeps the question answerable"). The operator path builds its reply with `consultationReply()`.

Measured in the three recorded human runs of #315: four structured consultation replies, all bare JSON objects, and zero `reply_child` errors. The sample is small and only run 3 had reply validation, so this bounds the rate loosely; the refusal path, not the rate, carries the decision. With no observed occurrence and a correctable refusal on the only model-authored path, extracting JSON from wrapped text would add a parser and an ambiguity surface without a demonstrated need. The strict parser stays.

## Adjudication binding

Only `extensions/action-authorization.ts` changed among the bound sources: return types narrowed from `AuthorizationDecision` to `ClassifiedDecision`, and state that nothing read was removed. The rules, interpretation, assessment, proposal construction and audit entries are unchanged.

Independent binding check `a3bf11f1` recomputed both hashes (`988a15b6…` adjudicated, `e43af5fe…` current), read the diff and every caller of `installActionAuthorization`, and returned pass: no caller reads the removed return value, and nothing that reaches a decision, `onDecision`, an audit entry or a commit changed. `tools/contextual-authorization-evaluation/adjudication.json` now binds `e43af5fe…` and records that check; the 32 adjudicated dispositions and the corpus digest are unchanged.
