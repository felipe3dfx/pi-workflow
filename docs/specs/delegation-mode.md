# Delegation mode

Status: SPECIFIED (#205).

Package: the decisions confirmed in the #205 grilling session (2026-10-08), recorded in GLOSSARY.md (Delegation mode) and ADR 0015, and corrected by the dispositions of the review.
Review handoff: `docs/specs/delegation-mode-review.md`, run after the first publication of this specification.
Dependency: fan-out from `codemode` (Group, Launch limit), already shipped.

## Problem

The parent session decides on every user message whether to do the work itself or to delegate it to a child session. When it does the work itself, the main thread is busy reading, editing, and running commands, and the operator cannot keep conversing with it while that work runs. The operator has no way to ask the parent to stay an orchestrator that plans, delegates, and synthesizes.

## Solution

The operator chooses a Delegation mode in `/workflow:config`: `opportunistic`, today's behavior and the default, or `orchestrator`. In `orchestrator`, while the parent has the child tools, it is told to delegate all work to child sessions and to keep to conversing, planning, asking, and directing children. The mode itself never blocks a tool. It works with Jev routing on or off. With Jev routing on, Jev keeps routing but only lets a message stay in the parent when it needs no work or asks only for the reserved `git` and `gh` operations.

## User stories

1. As the operator, I want to choose a Delegation mode in `/workflow:config`, so that I decide whether the parent may do work itself.
2. As the operator, I want my Delegation mode to persist across Pi restarts, so that I choose it once.
3. As the operator, I want the Delegation mode stored in my agent directory beside Jev routing, so that it follows me across repositories.
4. As the operator, I want `opportunistic` to be the default, so that updating the package changes nothing until I choose.
5. As the operator, I want a missing, unreadable, or invalid stored Delegation mode to resolve to `opportunistic`, so that a broken file never changes how the parent behaves.
6. As the operator, I want changing Jev routing never to change my Delegation mode, and the reverse, so that each choice stays as I left it.
7. As the operator, I want `opportunistic` to behave exactly as today with Jev routing on or off, so that the current workflow keeps working.
8. As the operator, I want `orchestrator` to work with Jev routing off, so that I get an orchestrating parent without a TypeSafe key.
9. As the operator, I want `orchestrator` to work with Jev routing on, so that Jev still picks the Specialist while the parent orchestrates.
10. As the operator, I want the parent told to delegate all work in `orchestrator`, reading included, so that its context stays free for our conversation.
11. As the operator, I want the parent in `orchestrator` to keep conversing, planning, asking, and directing children, so that orchestration stays in the main thread.
12. As the operator, I want the parent in `orchestrator` to keep the mutating and publishing `git` and `gh` operations, and the `git` reads they need, so that commits, pushes, and pull requests still happen under supervision.
13. As the operator, I want the parent in `orchestrator` to keep reading the context files the Tool gate already exempts, so that it plans with the repository's rules.
14. As the operator, I want the instruction to name the Todo and operator questions only when they are seated, so that the parent is never told to use a tool it lacks.
15. As the operator, I want the Delegation mode itself never to block a tool, so that a wrong instruction never leaves the parent unable to act; with Jev routing on, Jev's verdict still gates as today.
16. As the operator, I want the parent told to follow a refused launch and tell me why, so that a Launch blocked or a Launch limit never turns silently into the parent doing the work.
17. As the operator, I want Jev, in `orchestrator`, to let a message stay only when it needs no work or asks only for the reserved `git` and `gh` operations, so that small work goes to a child and commits stay possible.
18. As the operator, I want Jev's criteria unchanged in `opportunistic`, so that its routing stays as I know it.
19. As the operator, I want Jev to remain the only routing owner while Jev routing is on, so that the parent never overrides it.
20. As the operator, I want `/workflow:delegation-check` to score the current Delegation mode with the expectations of that mode, so that the check reflects the routing I actually run.
21. As the operator, I want the parent to behave as in `opportunistic` while it does not have the child tools, so that it is never told to delegate without a way to do it.
22. As the operator, I want a child session never to receive the orchestrator instruction, so that children keep doing the work.
23. As the operator, I want the Delegation mode shown in `/workflow:config` beside Jev routing, so that I see both routing choices together.
24. As the operator, I want cancelling `/workflow:config` to write nothing, so that a closed menu never changes the mode.
25. As the operator, I want the Apply review to name a Delegation mode change, so that I confirm what will change.
26. As the parent, I want the instruction on every model call, including the runs a child result or question starts, so that I keep the stance while I synthesize children's work.
27. As the parent, I want the instruction to follow a mode change in the same session, so that the operator's new choice applies from the next model call.

## Implementation decisions

Every decision below was resolved by the developer in the #205 grilling session or in the review dispositions. All are mandatory unless labeled a recommendation.

### The choice

- Delegation mode is a persistent choice with the values `opportunistic` and `orchestrator`, stored in its own document in the agent directory, beside the Jev routing document. Source: GLOSSARY.md, Delegation mode; ADR 0015; review D8.
- It is independent of Jev routing: all four combinations are valid, and writing one choice never rewrites the other. It is not a third value of Jev routing. Source: ADR 0015.
- The default is `opportunistic`. A missing or unreadable document, or an unknown value, reads as `opportunistic`, as Jev routing reads as off. It is read on every check, like Jev routing.

### Configure

- `/workflow:config` shows the Delegation mode with Jev routing, and the Apply review names a change to it. Cancelling writes nothing.
- `/workflow:config` does not refuse any combination of the Delegation mode with the selection. Source: review D3.

### The instruction

- The instruction applies while the Delegation mode is `orchestrator` and the parent has the child tools: child session is seated and the child tools are offered, which a legacy subagent package can withhold. Otherwise the parent behaves as in `opportunistic`. Source: ADR 0015; review D3.
- The harness adds the instruction to the parent's system prompt on every model call, including runs that a child result or question starts, through Pi's `context_with_system` event. `before_agent_start` is not enough: Pi fires it only for a prompt the user submits. Source: review D1.
- Pi sends the handler's result as returned, so the handler owns the prompt and the tool declarations. While the instruction does not apply, it returns nothing and leaves the messages untouched. While it applies, it keeps the leading system message and its tool declarations and adds the instruction to that system message, never as a later message in the conversation.
- The instruction tells the parent to:
  - delegate all work to child sessions, reading included;
  - keep to conversing, launching, steering, answering, and reading children, and, only when each is seated, planning with the Todo and asking operator questions;
  - keep in the parent the mutating and publishing `git` and `gh` operations (ADR 0013) and the `git` reads they need, and the context files the Tool gate already exempts;
  - follow a refused launch, such as a Launch blocked or the Launch limit, and tell the operator why, without retrying silently or doing the work itself unannounced.
  Source: review D7, D9.
- The instruction never reaches a child session's system prompt. Children never load the harness extension (ADR 0014).
- While the instruction does not apply, the parent's model calls are exactly what they are today.
- The `spawn_child` prompt guidelines do not carry the instruction. Source: ADR 0015.

### Jev routing

- With Jev routing on in `orchestrator`, the harness gives Jev a narrower criterion for the `stay` destination: the message needs no work, such as conversation, an opinion, or a question about what was already said, or it asks only for the reserved `git` and `gh` operations, such as a commit, a push, or opening a pull request. Every other message leaves or is decided. Source: ADR 0015; review D2.
- In `opportunistic`, Jev's questions and criteria are exactly what they are today.
- Jev remains the only routing owner while Jev routing is on. A `stay` verdict still refuses `spawn_child` in both modes. Source: ADR 0008.
- `/workflow:delegation-check` scores the current Delegation mode: it sends Jev the criteria of that mode and holds each case to the expected destination for that mode. In `orchestrator`, the small understood answer case expects a launch, and a new case that asks only for a commit and a push expects `stay`. Source: review D6.

### Shared-capability invariants

- The Tool gate does not change with the Delegation mode. It blocks only what it already blocks for the current Jev routing verdict. With Jev routing on in `orchestrator`, more messages leave, so the gate blocks the parent's gated tools more often; that is Jev's verdict, not the mode. Source: ADR 0015; review D5.
- The Launch limit, the child command policy for `git` and `gh` (ADR 0013), contracts, and Specialists are unchanged.

## Testing decisions

- Tests observe external behavior only: the menu and Apply review of `/workflow:config`, the stored documents read by a new process, the system message the parent's model call carries, the state and criteria Jev receives, and the delegation check's report. They do not inspect internal state.
- Primary seam: the full extension loaded with a fake `pi` that captures its handlers, a temporary agent directory, and the fake Jev classifier registry, as the delegation gate tests capture handlers and the workflow settings tests drive configure. It covers configure, persistence across a new process, each choice surviving a write of the other, the instruction in each mode, with each seating, and with the child tools withheld, the unchanged model call while the instruction does not apply, the Jev `stay` criterion in each mode, and the delegation check in each mode.
- A run that a child result starts is observed through a real Pi session with the harness extension loaded, because the fake `pi` cannot tell it from other calls: its model call carries the instruction in `orchestrator`.
- A child's prompt is observed as the prompt the harness hands to the child session factory; it never carries the instruction.
- Secondary seam: the stored choice reader, for the default and for a missing, unreadable, or invalid document.
- Regression: the existing Jev routing off and delegation gate tests pass unchanged, which shows `opportunistic` keeps today's behavior.
- Prior art: the workflow settings tests, the Jev routing off tests, the delegation gate tests, the delegation check tests, and the fake Jev support.

## Out of scope

- Blocking or default-denying parent tools in `orchestrator`. Source: ADR 0015, rejected by the owner.
- A `/workflow:config` refusal or a status and doctor warning for `orchestrator` without child tools. Source: review D3.
- Reporting or counting tool uses the parent makes itself in `orchestrator`.
- Letting children commit, push, or publish.
- Per-repository Delegation mode.
- Changes to the Launch limit, Specialists, contracts, or the child command policy.
- A Jev verdict that lets `spawn_child` launch after `stay`.

## Further notes

- ADR 0015 records the decision to guide the mode with the prompt rather than the Tool gate, and the rejected alternatives.
- Accepted risk: `orchestrator` is an instruction, not a guarantee. The parent may still do work itself, and nothing reports it.
- Accepted risk: another extension that sets the system prompt through `before_agent_start` makes Pi replace the leading system message for that run, which drops the instruction.
- The "measured" precondition in the original #205 was dropped: no decision depends on a fan-out measurement.
- The review merged the Jev criterion into the same ticket as the instruction, so that no release ships `orchestrator` with today's `stay` criterion. Source: review D4.
