# Matt Pocock / AI Hero workflow research: Wayfinder -> grilling -> spec -> tickets

## Scope

This note extracts first-party facts about the conversational flow described in the AI Hero v1.1 changelog and the linked skill docs. It focuses on artifact boundaries, handoffs, and ownership. It does **not** propose harness behavior as fact.

## Primary sources

- AI Hero changelog v1.1: <https://www.aihero.dev/skills/skills-changelog-v1-1-wayfinder-to-spec-to-tickets-grilling-improvements>
- `/wayfinder`: <https://www.aihero.dev/skills-wayfinder>
- `/grilling`: <https://www.aihero.dev/skills-grilling>
- `/grill-with-docs`: <https://www.aihero.dev/skills-grill-with-docs>
- `/domain-modeling`: <https://www.aihero.dev/skills-domain-modeling>
- `/to-spec`: <https://www.aihero.dev/skills-to-spec>
- `/to-tickets`: <https://www.aihero.dev/skills-to-tickets>
- Supporting ticket-type docs: `/research` <https://www.aihero.dev/skills-research>, `/prototype` <https://www.aihero.dev/skills-prototype>

## Source facts

### 1) There are two upstream entry shapes, not one

- The article's main build chain is: `grill-with-docs -> to-spec -> to-tickets -> implement -> code-review`.
- But Wayfinder is explicitly positioned **upstream** of that chain for efforts that are too large or foggy for one session. Its job is to clear the route until the work is spec-able, then hand off to `to-spec`.
- So the first-party flow is really:
  - small/clear enough: `grill-with-docs -> to-spec -> to-tickets`
  - too big/foggy: `wayfinder -> (resolve map tickets over multiple sessions) -> to-spec -> to-tickets`

Sources: changelog article; `/wayfinder`; `/to-spec`; `/to-tickets`; `/grill-with-docs`.

### 2) Wayfinder owns planning under uncertainty, not specification or implementation

- `/wayfinder` is for an effort "too big for one agent session" where the route to the destination is still "wrapped in fog".
- It "plans, it doesn't do": each ticket resolves a decision, and the map is done when nothing remains to decide before building.
- It produces a **shared map** on the issue tracker plus child tickets; the map is an **index, not a store**.
- Each decision lives in exactly one place: its ticket. The map only gists and links to those decisions.
- A Wayfinder session resolves **at most one ticket**.
- After the fog is cleared, the handoff is to `to-spec`, not directly to implementation.

Sources: `/wayfinder`; changelog article.

### 3) Wayfinder artifacts and boundaries are tracker-native

- Canonical Wayfinder artifact: one `wayfinder:map` issue.
- Child artifacts: child issues/tickets under that map.
- State model inside the map:
  - `Destination`
  - `Notes`
  - `Decisions so far`
  - `Not yet specified`
  - `Out of scope`
- The frontier is the open, unblocked, unclaimed child tickets.
- Blocking should use the tracker's native dependency model when available.
- Assets created while resolving a ticket are linked from the issue; the answer itself is recorded as a **resolution comment** when the ticket closes.

This means Wayfinder's durable memory lives primarily in tracker objects and linked artifacts, not in a spec document.

Sources: `/wayfinder`; changelog article.

### 4) Wayfinder ticket ownership is by question type

Wayfinder defines four ticket types, each with a different owner/interaction pattern:

- **Research (AFK):** agent reads primary sources and produces a markdown summary as a linked asset.
- **Prototype (HITL):** create a cheap artifact to raise discussion fidelity; artifact is linked from the ticket.
- **Grilling (HITL):** live question/answer decision session using grilling/domain-modeling.
- **Task (HITL or AFK):** prerequisite manual/operational work needed before a later decision can be made.

Important boundary: HITL tickets must resolve through a live human exchange; the agent must not answer its own grilling questions.

Sources: `/wayfinder`; `/research`; `/prototype`; changelog article.

### 5) Grilling is the interview primitive; grill-with-docs is the artifact-producing wrapper

- `/grilling` is the core interview technique: one question at a time, dependency-ordered, with a recommended answer, and it explores the codebase for facts it can settle itself.
- It is the "single source of truth" for the interview technique and is reused by other skills.
- `/grill-with-docs` wraps that interview and adds persistence:
  - resolved terms go to `CONTEXT.md`
  - high-bar, hard-to-reverse decisions go to `docs/adr/`
- `/grill-with-docs` is stateful and writes during the conversation; `to-spec` is explicitly **not** another interview.

This is the key ownership split:

- `grilling` owns the conversational method
- `domain-modeling` owns glossary/ADR discipline
- `grill-with-docs` owns applying both during an interview

Sources: `/grilling`; `/grill-with-docs`; `/domain-modeling`; changelog article.

### 6) Domain-modeling does not own the spec

- `/domain-modeling` writes to exactly two artifact classes:
  - `CONTEXT.md` for vocabulary
  - `docs/adr/` for consequential decisions
- It explicitly keeps `CONTEXT.md` free of implementation detail and says the glossary is "nothing else" — no spec, no scratch pad.
- Downstream, a settled glossary becomes input for `to-spec`, which writes the actual spec in the project's own vocabulary.

So the spec boundary is intentionally separate from the glossary/ADR boundary.

Sources: `/domain-modeling`; `/to-spec`; `/grill-with-docs`.

### 7) To-spec owns synthesis of settled understanding into a tracker-published spec

- `/to-spec` turns the current conversation and codebase understanding into a spec and publishes it to the issue tracker.
- It does **not** re-interview the user; by the time you invoke it, alignment is expected to be done.
- It includes:
  - problem statement
  - solution
  - numbered user stories
  - implementation decisions already settled
  - testing decisions
  - out-of-scope items
  - further notes
- Before writing, it identifies testing seams and deep-module opportunities.

So `to-spec` owns packaging already-decided intent into a durable implementation target.

Sources: `/to-spec`; changelog article.

### 8) To-tickets owns implementation slicing, not problem discovery

- `/to-tickets` breaks a plan/spec/conversation into tickets and publishes them to the tracker.
- In the main flow, it sits **after** `to-spec` and consumes a settled spec.
- Its tickets are tracer-bullet **vertical slices**, not horizontal layers.
- Each ticket declares its blockers.
- The same artifact has two readings:
  - local file mode: one `tickets.md` with textual edges
  - real tracker mode: one issue per ticket with native blocking links
- It quizzes the user on granularity/blocking before publishing.

So `to-tickets` owns decomposition for execution readiness, not clarification of what should be built.

Sources: `/to-tickets`; changelog article.

## Artifact ownership summary

| Stage | Skill owner | Primary artifact(s) | What it owns | What it explicitly does not own |
| --- | --- | --- | --- | --- |
| Unclear, too-large effort | `wayfinder` | tracker map + child tickets + resolution comments + linked assets | decision map, frontier, fog clearing, question routing | final spec, implementation |
| Live clarification | `grilling` | conversation only | interview method, dependency-ordered questions | durable docs by itself |
| Live clarification with persistence | `grill-with-docs` + `domain-modeling` | `CONTEXT.md`, `docs/adr/` | vocabulary capture and consequential decisions during grilling | spec, ticket slicing |
| Settled definition | `to-spec` | tracker-published spec | synthesised destination, user stories, testing decisions, scope boundary | re-grilling, ticket decomposition |
| Execution decomposition | `to-tickets` | `tickets.md` or tracker tickets with blockers | vertical slices and dependency edges | problem discovery, domain glossary |

## Handoff boundaries

1. **Wayfinder -> to-spec**
   - Trigger: the route is clear enough that nothing material remains to decide before building.
   - Handoff artifact: the resolved map and its ticket history, with tickets as the primary sources.

2. **Grill-with-docs -> to-spec**
   - Trigger: shared understanding reached; domain language settled.
   - Handoff artifacts: conversation state plus `CONTEXT.md`/ADRs.
   - Constraint: `to-spec` should synthesize, not ask a fresh interview round.

3. **To-spec -> to-tickets**
   - Trigger: there is a settled spec with user stories and testing decisions.
   - Handoff artifact: the spec.

4. **Wayfinder ticket internals**
   - Research/prototype/grilling/task each produce their own localized artifacts, but Wayfinder keeps the map as an index and links outward instead of absorbing all detail.

## Recommendations for pi-workflow

These are design interpretations, not source facts.

- Preserve the **artifact split**. Do not collapse glossary, ADRs, spec, and ticket graph into one blob. Matt's workflow is opinionated about each artifact having a different job.
- Treat **Wayfinder as upstream uncertainty management**, not as spec generation. If pi-workflow models it, its done condition should be "route is clear" rather than "spec written".
- Keep **grilling primitive vs wrapper** separate. The interview behavior and the persistence behavior are distinct concerns.
- Make the **handoff contracts explicit**:
  - grilling resolves understanding
  - domain-modeling persists vocabulary/decisions
  - spec synthesizes settled intent
  - tickets decompose settled intent for execution
- If pi-workflow supports a map/tracker mode, keep the **map as index, not store**. Decision detail should remain attached to the ticket/artifact that produced it.
- If pi-workflow supports local-file fallback, mirror the Matt split where tickets can degrade from tracker-native edges to a textual `tickets.md`, but do not lose blocker semantics.

## Open questions / verification risks

- The article's prose says "start with grilling," but the concrete artifact-producing flow is more precisely `grill-with-docs`, not bare `grilling`.
- `to-tickets` can accept a plan/spec/current conversation, but the documented main chain still positions it after `to-spec`; using it directly from conversation is supported, but is not the canonical happy path.
- The AI Hero skill pages are first-party docs and link to GitHub source locations, but this note did not separately inspect the repository markdown at those source URLs.