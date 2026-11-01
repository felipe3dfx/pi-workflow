# Language boundaries by interlocutor

Status: Specification synthesized from a READY functional definition; not
implemented. The synthesis report records independent verification and
publication status. Behavioral QA not run.

- Role: final technical specification.
- Definition package: `agent-communication-language/v2`.
- Functional handoff: `agent-communication-language/v2/feature-critic-final`.
- Technical handoff: `agent-communication-language/v2/to-spec`.
- Brief: [approved definition](../features/agent-communication-language.md).
- Final functional review: [feature-critic](../features/agent-communication-language-review.md).
- Synthesis report: [agent-communication-language-review.md](agent-communication-language-review.md).
- Feature-critic verdict: `READY`, with no open findings or accepted warnings.
- Prototype and Approved Prototype UI Contract: none; no prototype is required.

## Problem and solution

A developer who coordinates child sessions in a non-English conversation
sees agent-to-agent text drift into that language: parent clarifications
sent through `reply_child`, and child results whose Reason and change
descriptions are no longer English. The rule that should prevent this lives
only in this repository's `AGENTS.md`, so consuming projects do not get it,
and the reusable contracts deliberately stopped carrying it in `b329eea`.

The harness will carry the language boundary itself, for every consuming
project: one dedicated parent session-level instruction, and a matching rule
in every child Contract. Agent-authored parent↔child text is English; the
user conversation stays in the user's language; transported content keeps
its own language. Transport, the Fleet view and existing protocol shapes
are unchanged. The instruction is strong guidance, not detection or
blocking.

Business intent belongs to the user. Canonical terms remain those of
`GLOSSARY.md`; this specification introduces no new canonical concept.

## User stories

1. As a developer conversing in Spanish, I receive explanations of child
   questions and results in Spanish, while the parent writes every
   clarification, continuation and reply to the child in English.
2. As a developer, when I explicitly ask the parent to switch language, only
   my side of the conversation changes; parent↔child text stays English.
3. As a developer, I receive a Spanish ticket draft from a child intact,
   accompanied by an English report.
4. As the operator, my Steer and Fleet view answers reach the child exactly
   as I wrote them, and the child still reports to the parent in English.
5. As the maintainer of a consuming project, I get this behavior without
   adding a language rule to my `AGENTS.md`.

## Readiness, authority and source identity

The stable brief and final functional review are available and consistent.
All material functional decisions are accepted, every critique finding is
disposed, and the affected lenses reverified the v2 clarification. Three
technical decisions were resolved by the user during synthesis (T1–T3).

| Input | SHA256 |
| --- | --- |
| Stable brief | `4a9b841d44f1cb0b12d5eed61ad308222e903f67bc6295697ca772b7bf5dbd5c` |
| Final functional review | `6f7e1bcce5bf7bed662698f9216a8856f201b38cd845b880ce8bd6a9f8f2279d` |
| Installed Pi 1.4.0 `docs/extensions.md` (seam evidence) | `46fc0baeb00db8ca8db399e33e0f506e86e425693b291258357e8063e2f3353c` |

- Root authority: `GLOSSARY.md`, selected by `docs/agents/domain.md`.
- Applicable decisions: ADR 0010 (result delivery), ADR 0015 (Delegation
  mode guided by the prompt), ADR 0017 (Contract precedence over context
  files), ADR 0025 (consultation reply shape and harness-message tools).
- Generated Domain Authority Handoff: absent, admissible separately.
- Generated read-only authority review: absent, admissible separately.
  Functional and semantic decisions are closed; neither absence requires a
  glossary, ADR or repository-policy change.

Symptom evidence: a private consuming-project session, identified only by
basename `2026-11-01T13-44-33-297Z_01a1975a-cf11-701d-8d97-641721e5ec02.jsonl`.
Lines 78 and 133 carry Spanish `reply_child` answers after English
`spawn_child` tasks; line 83 carries a `pi-workflow-child-result` whose
Reason and `files_changed` descriptions are Spanish. This proves the
symptom, not a complete runtime root cause.

## Decision ledger

All entries are accepted unless stated. None is superseded by recency.

| ID | Decision | Resolver and source | Status and supersession |
| --- | --- | --- | --- |
| D1 | Language separation by interlocutor | User; initial direct request | Accepted; none |
| D2 | General harness scope for every consuming project | User; option 1 "General en pi-workflow — recomendado" | Accepted; supersedes only the repository-local scope reflected in `b329eea`; publication-artifact language policy is not superseded |
| D3 | Entire brief accepted | User; option 1 "Aceptar el brief" | Accepted for feature critique, not implementation |
| D4 | Retain the explicit transported-content enumeration | User; rejection of scope lens F1 | Simplification rejected; no content change |
| D5 | Existing channels only; operator Fleet messages excluded; child reports and questions to the parent stay English | User; option 1 "Sí, dejarlos fuera — recomendado" | Accepted; clarifies original scope, not an expansion |
| T1 | A dedicated parent session-level language instruction plus the rule in every child Contract, not solely tool declarations; independent of Delegation mode and of which child tools are offered; transport and Fleet view untouched; strong instruction, no automatic detection or blocking | User; option 1 in to-spec | Accepted; none |
| T2 | Deterministic instruction-delivery tests plus real Pi session QA with transcript evidence as behavioral acceptance; no new live evaluation framework; `npm run check` stays the deterministic gate | User; option 1 in to-spec | Accepted; QA not yet executed |
| T3 | Documentation-only pull request to `main` for this specification | User; confirmation in to-spec | Accepted; authorizes neither merge nor implementation |

## Observable contract

### Language rules

1. Text the parent agent authors for a child (tasks, continuations,
   clarifications, replies, and the free-text answer of a consultation
   reply) is English, whatever the user's language.
2. Text a child authors for the parent (questions, findings, reports,
   Verdict reasons, change and validation descriptions) is English,
   whatever the language of the task, the user or an operator message.
3. The parent converses with the user in the user's language, honoring an
   explicit user language instruction. Child messages never change that
   language.
4. The parent presents child questions and conclusions to the user in the
   user's language, and conveys the user's decisions to children in
   English.
5. Transported code, identifiers, tool outputs, quotations and artifacts
   keep their content or the language their destination requires. Stable
   JSON keys, enum values and identifiers are transported content and are
   never translated.
6. Operator messages written directly in the Fleet view (Steer, question
   answers and authorization answers) are delivered unchanged and are
   outside these rules.

### Scenarios

| # | Given | When | Then |
| --- | --- | --- | --- |
| S1 | English task, Spanish user | The user decides in Spanish and the parent clarifies through `reply_child` or continues through `continue_child` | The parent-authored text is English |
| S2 | A child asks through `ask_parent` | The parent relays the question to a Spanish user | The child's question is English; the user sees it in Spanish |
| S3 | A child ends with a result | The parent explains it to a Spanish user | The result is English; the explanation is Spanish |
| S4 | A task asks for a Spanish ticket draft | The child reports | The draft stays Spanish; the accompanying report is English |
| S5 | The user explicitly switches to English | The conversation continues | Only the user-side language changes; parent↔child text stays English |
| S6 | The operator steers or answers in Spanish in the Fleet view | The child receives it and later reports | The operator text arrives unchanged; the child's report is English |
| S7 | A consultation reply | The parent answers | `ref`, `kind` and `confirm` keep their values; only free text is English |
| S8 | Either Delegation mode, contextual or non-contextual variant | Any of S1–S7 | The same rules apply |

Existing scope, authority, consultation, question and result semantics are
unchanged in every scenario.

## Implementation decisions

Each decision states whether it is mandatory or a recommendation, with its
evidence, reason and necessity. Module and file names below are current
evidence locations; they may move without changing this contract.

### Parent language instruction

**Mandatory — sources T1, D1–D5, ADR 0015.** Deliver a dedicated language
instruction in the parent session's system prompt on every model call,
independent of Delegation mode and of whether child tools are offered. It
carries rules 1, 3, 4, 5 and the non-modification of operator messages in
rule 6. Necessity: T1 places the rule at session level, and the observed
Spanish `reply_child` text came from the parent itself.

Keep it separate from the Delegation mode section. ADR 0015 adds that
section only in `orchestrator` with the child tools offered, and leaves
`opportunistic` without it; neither condition may change. ADR 0015 also
rejected tool guidelines as the home of a whole-session stance, which is
why T1 does not rely on tool declarations alone. Tool descriptions and
guidelines need no change, and must not contradict the instruction.

**Recommendation — evidence: installed Pi 1.4.0 `docs/extensions.md` and
its official `prompt-customizer` example.** Add the instruction as one
private named section through `before_agent_start` and its structured
`systemPromptOptions.sections`. Pi documents this as the preferred prompt
customization: it runs for runs started by user messages and by custom
messages that trigger a turn, which is how child results reach the parent
under ADR 0010, and Pi records the structured section delta in the
transcript. This is the highest useful existing SDK seam. Do not use
`forceSystemPrompt`, a returned whole `systemPrompt`, or transcript
mutation. The current Delegation mode seam stays as it is. The section
needs no new exported module, function, public option or configuration.
This hook is an evidence-backed recommendation, not a user mandate; an
alternative must deliver the same instruction on the same model calls.

### Child Contracts

**Mandatory — sources T1, D1, D4, D5, ADR 0017.** Carry rules 2 and 5 in
all four Contracts: `explore`, `worker`, `verify` and `contextual`, so both
the role-contract and contextual launch variants receive them. Include that
operator messages do not change the reporting language and that transported
artifacts keep their language. Necessity: the observed Spanish result at
line 83 was child-authored, and consuming projects' context files cannot be
assumed to supply the rule (D2).

ADR 0017 already gives a Contract precedence over context files; that
precedence and the parent's instruction hierarchy stay unchanged. The rule
adds no authority and removes none.

**Mandatory verification — source: launcher evidence.** Children receive
their Contract through the launched process's system prompt, and a
continued child resumes from its stored launch plan. Verify the effective
system prompt of a continued child launched after this change instead of
assuming that the replay carries the current Contract. If verification
shows that providing it would change continuation semantics, return that as
a question rather than changing them.

### Harness-message and consultation surfaces

**Mandatory — sources D5, ADR 0010, ADR 0025.** `spawn_child`,
`continue_child`, `reply_child`, `ask_parent`, result delivery, Steer and
Fleet view answers keep their parameters, shapes, delivery timing,
consumption and authority semantics. Consultation replies keep `ref`,
`kind`, `answer` and `confirm` and their meaning; only the parent-authored
free text is English. No message is rewritten, translated or inspected in
transit.

### Local policy and its test

**Mandatory — sources D2, AGENTS.md authority.** The local `AGENTS.md`
Language Contract stays as it is; this change neither deletes it nor alters
publication-language rules. The existing test that asserts the local
sentence "without imposing consumer language policy" carries an outdated
premise under D2: update it to assert the packaged instruction coverage.
Asserting the local sentence is no longer the evidence of this behavior.

### Excluded architecture

**Mandatory — sources T1, C3 of the functional review.** No language
detection, classifier, gate, linter, translation service, new channel,
public option or configuration value. Necessity: T1 chose a strong
instruction without detection or blocking, and no evidence shows a need
for more.

## Shared-capability comparisons and invariants

| Capability | Comparison evidence | Invariant for implementation and slicing |
| --- | --- | --- |
| Delegation mode | Current parent section through the system-message seam, only in `orchestrator` with child tools | Unchanged conditions and text; the language section is independent and present in both modes |
| Child Contracts | Four Contract assets; launcher chooses role or contextual variant | Every variant carries the rule; precedence over context files unchanged |
| Delegation and continuation | `spawn_child` and `continue_child` | No parameter or behavior change; continued children verified |
| Questions and replies | `ask_parent`, `reply_child`, ADR 0025 consultation reply | Same shape and correlation; free text English; keys and enums untranslated |
| Result delivery | ADR 0010 pending and consumed results | Same timing, batching and consumption; result text English |
| Operator Steer and Fleet answers | Fleet view direct paths | Delivered unchanged; outside the rule |
| Local repository policy | `AGENTS.md` Language Contract | Kept; no longer the only carrier |
| Domain authority | GLOSSARY; ADR 0010/0015/0017/0025 | No canonical change |

## Testing decisions

Tests are mandatory evidence for the approved behavior, not proof already
obtained. Read `test/support/README.md` before extending a helper and reuse
the existing model-endpoint and installed-Pi fixtures.

### Deterministic instruction delivery (mandatory, T2)

1. **Parent, both modes.** With the real SDK and a fake provider capturing
   requests, assert the language section on parent model calls in
   `opportunistic` and `orchestrator`, with Jev routing on and off, with and
   without child tools offered, and on a run started by delivered child
   results. Assert the Delegation mode section and its conditions are
   unchanged. The current assertion that `opportunistic` leaves the model
   call untouched changes only to allow the language section.
2. **Children, all variants.** With a real Pi child answering through the
   local `fake/echo` endpoint, assert the rule in the effective system
   prompt for `explore`, `worker`, `verify` and the contextual variant, and
   for a continued child.
3. **Surfaces unchanged.** Existing child-session tests for reply, Steer,
   questions, consultations and results keep passing without changes to
   their expected shapes; Steer and Fleet answer text arrives byte-for-byte.
4. **Local premise.** The child-contract test asserts packaged coverage
   instead of the local `AGENTS.md` sentence.

Assertions for newly introduced instruction delivery must fail on the
starting implementation and pass after the change. Regression assertions
that preserve existing behavior may already pass on the starting
implementation. Instruction presence proves delivery only, not compliance.

### Behavioral QA (mandatory future acceptance, T2; not run)

Run ordinary real Pi sessions with a consuming project; no specialized
contextual-authorization host or new evaluation framework is needed.
Observe at least:

- English `spawn_child`, `continue_child` and `reply_child` text after a
  Spanish user decision (S1).
- English `ask_parent` and result text, with a Spanish draft preserved
  (S2–S4), and the parent explaining both to the user in Spanish.
- An explicit user switch to English changing only the user side (S5).
- Spanish Steer or Fleet answer text delivered intact, with the child's
  report still English (S6).

Record the Pi version, package version, model, model profile, Delegation
mode and variant, session evidence pointers and pass or fail per scenario.
Coverage of every mode and variant comes from the deterministic tests, not
from manual exhaustiveness. Claim no universal compliance and use no
language heuristics. Missing credentials or a missing installed Pi make the
acceptance unverified or blocked; never infer a pass.

The repository gate remains `npm run check`. Mutation testing is
unsupported by the consumer contract and is not a delivery prerequisite.

## Dependencies, native relationships and exclusions

The change reuses the existing prompt-customization seam of the installed
Pi, the child Contracts, the launcher and the existing test fixtures. It
needs no new package, channel, glossary entry or ADR. There is no
prerequisite ticket or blocking relationship to invent. Per T3, this
specification travels in a documentation-only pull request to `main`;
parent identity, publication state and implementation slicing belong to the
publication handoff and `to-tickets`.

Out of scope: translating historical sessions; changing publication-artifact
language policy; localizing the harness interface; translating or rewriting
operator messages; changing delegation, routing, authority or delivery
semantics.

## Deviations, risks and evidence limits

- Deviations: none.
- Accepted risks: none.
- Evidence limits: the transcript proves the symptom, not a complete
  runtime root cause; the instruction is guidance a model may still not
  follow; continuation replay is unverified; no test or QA has run for this
  change. These are validation obligations, not accepted risks.

## Handoff

Hand `to-tickets` this specification, the synthesis report, the stable
brief and the final functional review under package
`agent-communication-language/v2` and handoff
`agent-communication-language/v2/to-spec`, with the verified parent
identity once published. Preserve D1–D5, T1–T3, the mandatory constraints,
the recommendation status of the prompt seam and the test obligations. A
functional defect returns to `feature` and `feature-critic`; do not edit a
published definition during slicing.
