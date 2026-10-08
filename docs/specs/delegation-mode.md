# Delegation mode

Status: SPECIFIED (#205).

Package: the decisions confirmed in the #205 grilling session (2026-10-08), recorded in GLOSSARY.md (Delegation mode) and ADR 0015.
Review handoff: none. This specification was synthesized from the grilling session without a `feature-review` report.
Dependency: fan-out from `codemode` (Group, Launch limit), already shipped.

## Problem

The parent session decides on every user message whether to do the work itself or to delegate it to a child session. When it does the work itself, the main thread is busy reading, editing, and running commands, and the operator cannot keep conversing with it while that work runs. The operator has no way to ask the parent to stay an orchestrator that plans, delegates, and synthesizes.

## Solution

The operator chooses a Delegation mode in `/workflow:config`: `opportunistic`, today's behavior and the default, or `orchestrator`. In `orchestrator`, the parent is told to delegate all work to child sessions, reading included, and to keep to conversing, planning, asking, and directing children. The mode is a strong instruction, not a block: the parent can still use any tool. It works with Jev routing on or off. With Jev routing on, Jev keeps routing but only lets a message stay in the parent when it needs no work.

## User stories

1. As the operator, I want to choose a Delegation mode in `/workflow:config`, so that I decide whether the parent may do work itself.
2. As the operator, I want my Delegation mode to persist across Pi restarts, so that I choose it once.
3. As the operator, I want the Delegation mode stored beside Jev routing in my agent directory, so that it follows me across repositories.
4. As the operator, I want `opportunistic` to be the default, so that updating the package changes nothing until I choose.
5. As the operator, I want a missing, unreadable, or invalid stored Delegation mode to resolve to `opportunistic`, so that a broken file never changes how the parent behaves.
6. As the operator, I want `opportunistic` to behave exactly as today with Jev routing on or off, so that the current workflow keeps working.
7. As the operator, I want `orchestrator` to work with Jev routing off, so that I get an orchestrating parent without a TypeSafe key.
8. As the operator, I want `orchestrator` to work with Jev routing on, so that Jev still picks the Specialist while the parent orchestrates.
9. As the operator, I want the parent told to delegate all work in `orchestrator`, reading included, so that its context stays free for our conversation.
10. As the operator, I want the parent in `orchestrator` to keep conversing, planning with the Todo, asking operator questions, and directing children, so that orchestration stays in the main thread.
11. As the operator, I want the parent in `orchestrator` to keep mutating and publishing `git` and `gh` operations, so that commits, pushes, and pull requests still happen under supervision.
12. As the operator, I want the parent never blocked from a tool because of the Delegation mode, so that a wrong instruction never leaves it unable to act.
13. As the operator, I want Jev, in `orchestrator`, to let a message stay only when it needs no work, so that the parent is not refused a launch for small work.
14. As the operator, I want a conversational message, an opinion, or a question about what was already said to stay in the parent in `orchestrator`, so that I do not get a child for every reply.
15. As the operator, I want Jev's criteria unchanged in `opportunistic`, so that its routing stays as I know it.
16. As the operator, I want Jev to remain the only routing owner while Jev routing is on, so that the parent never overrides it.
17. As the operator, I want `/workflow:config` to refuse confirming `orchestrator` while child session is not seated, so that I never choose a mode the parent cannot follow.
18. As the operator, I want the parent to behave as in `opportunistic` while child session is unseated, so that it is never told to delegate without the tools to do it.
19. As the operator, I want status and doctor to report when `orchestrator` is chosen but has no effect, so that I notice the mismatch.
20. As the operator, I want a child session never to receive the orchestrator instruction, so that children keep doing the work.
21. As the operator, I want the Delegation mode shown in `/workflow:config` beside Jev routing, so that I see both routing choices together.
22. As the operator, I want cancelling `/workflow:config` to write nothing, so that a closed menu never changes the mode.
23. As the operator, I want the Apply review to name a Delegation mode change, so that I confirm what will change.
24. As the parent, I want the instruction in my system prompt for the whole session, so that the stance applies to every turn, not only when I consider `spawn_child`.
25. As the parent, I want the instruction to follow a mode change in the same session, so that the operator's new choice applies from the next turn.

## Implementation decisions

Every decision below was resolved by the developer in the #205 grilling session. All are mandatory unless labeled a recommendation.

### The choice

- Delegation mode is a persistent choice with the values `opportunistic` and `orchestrator`, stored in the agent directory beside Jev routing. Source: GLOSSARY.md, Delegation mode; ADR 0015.
- It is independent of Jev routing: all four combinations are valid. It is not a third value of Jev routing. Source: ADR 0015.
- The default is `opportunistic`. A missing key, a missing or unreadable document, or an unknown value reads as `opportunistic`, as Jev routing reads as off.
- Recommendation: store it as a second key in the document that holds Jev routing, read on every check like Jev routing, and resolve each key independently so that one invalid key does not reset the other.

### Configure

- `/workflow:config` shows the Delegation mode with Jev routing, and the Apply review names a change to it. Cancelling writes nothing.
- `/workflow:config` refuses to confirm `orchestrator` while the confirmed selection leaves child session unseated, and says why.

### The instruction

- In `orchestrator`, while child session is seated, the harness adds a section to the parent session's system prompt before each agent turn, through Pi's `before_agent_start` event. Source: ADR 0015.
- The section tells the parent to delegate all work to child sessions, reading included; to keep to conversing, planning with the Todo, asking operator questions, and launching, steering, and reading children; and to keep mutating and publishing `git` and `gh` operations in the parent (ADR 0013).
- The section never reaches a child session's system prompt.
- In `opportunistic`, or while child session is unseated, the parent's system prompt is exactly what it is today.
- The `spawn_child` prompt guidelines do not carry the instruction. Source: ADR 0015.

### Jev routing

- With Jev routing on in `orchestrator`, the harness gives Jev a narrower criterion for the `stay` destination: the message needs no work, such as conversation, an opinion, or a question about what was already said. Every other message leaves or is decided. Source: ADR 0015.
- In `opportunistic`, Jev's questions and criteria are exactly what they are today.
- Jev remains the only routing owner while Jev routing is on. A `stay` verdict still refuses `spawn_child` in both modes. Source: ADR 0008.

### Status and doctor

- Status and doctor report when the Delegation mode is `orchestrator` and child session is unseated, saying the mode has no effect.

### Shared-capability invariants

- The Tool gate does not change with the Delegation mode. It blocks only what it already blocks for the current Jev routing verdict. Source: ADR 0015.
- The Launch limit, the child command policy for `git` and `gh` (ADR 0013), contracts, and Specialists are unchanged.
- Delegation mode and Jev routing remain separate choices; turning one on or off never changes the other.

## Testing decisions

- Tests observe external behavior only: the menu and Apply review of `/workflow:config`, the stored document read by a new process, the system prompt returned for a parent turn, the state and criteria Jev receives, and the status and doctor text. They do not inspect internal state.
- Primary seam: the full extension loaded with a fake `pi`, a temporary agent directory, and the fake Jev classifier registry, as the workflow settings tests do. It covers configure, persistence across a new process, the system prompt section in each mode and seating, the unchanged prompt in `opportunistic` with Jev routing on and off, the absent section in a child's prompt, the Jev `stay` criterion in each mode, and the status and doctor report.
- Secondary seam: the stored choice reader, as the workflow settings tests use it, for the default and for a missing, unreadable, or invalid document.
- Regression: the existing Jev routing off and delegation gate tests pass unchanged, which shows `opportunistic` keeps today's behavior.
- Prior art: the workflow settings tests, the Jev routing off tests, the delegation gate tests, and the fake Jev support.

## Out of scope

- Blocking or default-denying parent tools in `orchestrator`. Source: ADR 0015, rejected by the owner.
- Reporting or counting tool uses the parent makes itself in `orchestrator`.
- Letting children commit, push, or publish.
- Per-repository Delegation mode.
- Changes to the Launch limit, Specialists, contracts, or the child command policy.
- A Jev verdict that lets `spawn_child` launch after `stay`.

## Further notes

- ADR 0015 records the decision to guide the mode with the prompt rather than the Tool gate, and the rejected alternatives.
- Accepted risk: `orchestrator` is an instruction, not a guarantee. The parent may still do work itself, and nothing reports it.
- The "measured" precondition in the original #205 was dropped: no decision depends on a fan-out measurement.
- The R12 reference in the original #205 was stale and was removed from the issue.
