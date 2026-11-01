# Feature brief: Language boundaries by interlocutor

Status: Functional definition accepted; final feature critique READY.
Not implemented. Implementation is not authorized by this brief.

- Role: stable functional brief.
- Definition package: `agent-communication-language/v2`.
- Functional handoff: `agent-communication-language/v2/feature-critic-final`.
- Final functional review: [agent-communication-language-review.md](agent-communication-language-review.md).

This brief is a meaning-preserving English capture of the complete brief the
user read in Spanish and explicitly accepted, plus the user-accepted v2
clarification. It records product intent, not an implementation mechanism.

## Problem and user

A developer coordinating child sessions finds internal instructions mixed
between English and the language of their own conversation. Parent-to-child
clarifications and child reports drift into the user's language even when
the original task is English.

Business intent owner: the user, through the definition conversation.
Canonical terminology comes from `GLOSSARY.md`.

## Desired behavior

1. Parent↔child tasks, continuations, clarifications, questions, replies,
   findings and results use English.
2. The user↔orchestrator conversation uses the user's language and respects
   an explicit language instruction from the user. Child messages do not
   change that language.
3. The orchestrator presents child questions and conclusions to the user in
   the appropriate user language, and conveys user decisions to children in
   English.
4. Transported code, identifiers, tool outputs, quotations and artifacts
   preserve their content or the language their destination requires. A
   child may deliver a Spanish ticket draft with an English accompanying
   report.

### Scope clarification (v2)

The English parent↔child rule governs agent-authored exchanges on the
existing channels, including `spawn_child`, `continue_child` and
`reply_child`. It creates no new channel to a running child. Messages the
operator writes directly in the Fleet view (Steer, question answers and
authorization answers) remain outside this rule and are delivered without
translation or modification. Child-authored reports and questions directed
to the parent remain English regardless of the operator message language.

## Scope

- All consuming projects, without requiring each `AGENTS.md` to repeat the
  rule.
- Exchanges after launch, where the observed transcript deviates.

Out of scope: translating historical sessions; changing document
publication-language policies; localizing the whole harness interface.

## Scenarios and invariants

- An English task followed by a Spanish user's decision still receives an
  English parent-to-child clarification.
- An English child question is conveyed to the user in the user's language.
- An English child result is explained to the user in the user's language.
- A Spanish ticket draft remains Spanish as a transported artifact.
- Existing scope, authority, and question and result semantics remain
  unchanged.

## Shared capabilities

Reuse existing delegation, child questions and parent replies, and result
delivery, preserving their current responsibilities. No new communication
channel. The operator's Steer and Fleet view answers are compatible with
this behavior because they stay outside the rule.

## Decisions

| ID | Decision | Resolver and source | Status | Supersession |
| --- | --- | --- | --- | --- |
| D1 | Language separation by interlocutor | User; initial direct request | Accepted | None |
| D2 | General harness scope for every consuming project | User; choice option 1 "General en pi-workflow — recomendado" | Accepted | Supersedes only the earlier repository-local scope reflected in commit `b329eea`; publication-artifact language policy is not superseded |
| D3 | Entire brief accepted | User; choice option 1 "Aceptar el brief" | Accepted for feature critique, not implementation | None |
| D4 | Keep the explicit transported-content enumeration | User; rejection of the scope lens's wording simplification | Simplification rejected; no content change | None |
| D5 | Existing channels only; direct operator Fleet messages excluded; child reports and questions to the parent stay English | User; option 1 "Sí, dejarlos fuera — recomendado" | Accepted | Clarifies the original parent↔child scope; not an expansion |

No material product question remains open. The runtime cause, the
implementation mechanism and behavioral validation belong to technical
synthesis; they are not silently preselected here.

## Evidence

- `AGENTS.md` contains this repository's local communication-language
  policy in its Language Contract.
- `test/child-contracts.test.mjs` asserts parent-only communication and the
  local `AGENTS.md` language sentence.
- Commit `b329eea` removed forced English from reusable contracts and
  `spawn_child` guidelines.
- `assets/contracts/contextual.md` has no equivalent English requirement.
- A consuming repository's `AGENTS.md` (`ilaos-ia-assistant`) has no
  equivalent communication-language rule.
- Observed private session, identified by basename only:
  `2026-11-01T13-44-33-297Z_01a1975a-cf11-701d-8d97-641721e5ec02.jsonl`.
  Line 78: a `reply_child` answer begins in Spanish ("…aprobó la opción A:
  mover ambos literales"). Line 83: a `pi-workflow-child-result` message carries a
  Spanish Reason ("La implementación y los checks focalizados están en
  verde…") and Spanish `files_changed` descriptions. Line 133: two
  `reply_child` answers begin in Spanish ("Esta sesión es solo el eje
  **Spec**…"). The surrounding `spawn_child` tasks are English. A later
  need/coherence follow-up also arrived in Spanish despite explicit English
  instructions.

The transcript demonstrates the symptom. It does not prove a complete
runtime root cause.

## Authority

- `GLOSSARY.md`, resolved by `docs/agents/domain.md`: Child session, Steer,
  Fleet view, Contract, Delegation mode, Verdict, Pending result,
  Consumed result, Operator question.
- ADR 0010 (child result delivery), ADR 0015 (Delegation mode guided by
  the prompt), ADR 0017 (Contract precedence over context files), ADR 0025
  (consultation reply shape).

No glossary or ADR change is proposed. No new domain concept is introduced.
No feature-specific generated Domain Authority Handoff or read-only
authority review was located; each absence is an admissible evidence gap,
not malformed or blocked authority.

## Dependencies, risks and readiness

Technical synthesis must define the mechanism and its validation.
Instruction-presence tests alone do not prove behavioral compliance.
Existing delegation, continuation, question and reply, and result delivery
must keep their responsibilities. No functional prototype is needed to
clarify the intended product behavior; implementation feasibility evidence
may still identify a real uncertainty.

Three independent lenses reviewed this definition; the affected lenses
reverified v2. The final functional review records READY with no blocker,
undisposed warning, authorized deviation or accepted risk. It is a static
review of documents and transcript evidence, not behavioral validation.
