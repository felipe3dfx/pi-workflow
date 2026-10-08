# ADR 0015: Delegation mode is guided by the prompt, not the tool gate

## Status

Acceptance: approval and merge of the introducing PR.

## Decision

Delegation mode is a persistent choice, stored beside Jev routing, with the values `opportunistic` and `orchestrator`. It is `opportunistic` until the operator chooses otherwise. It is independent of who owns routing, so it applies with Jev routing on or off.

In `orchestrator`, the harness adds a section to the parent session's system prompt on every model call that tells the parent to delegate all work to child sessions, reading included, and to keep to conversing, planning, asking, and directing children. Mutating and publishing `git` and `gh` operations stay with the parent, as ADR 0013 requires. The section is added only while the parent has the child tools, and never to a child's prompt. Without the child tools, the parent behaves as in `opportunistic`.

With Jev routing on in `orchestrator`, Jev still owns routing, but the harness gives it a narrower criterion for `stay`: the message needs no work, such as conversation, an opinion, or a question about what was already said, or it asks only for the reserved `git` and `gh` operations. Every other message leaves or is decided. In `opportunistic`, Jev's criteria stay as they are.

The tool gate does not change with Delegation mode. It blocks only what it already blocks for the current Jev routing verdict.

## Considered Options

- Enforce `orchestrator` in the tool gate by default-deny: the parent keeps only Todo, operator questions, child tools, `codemode` for fan-out, and the reserved `git` and `gh` operations. Rejected by the owner: the parent must never be blocked from using a tool in this mode.
- Add the instruction to the `spawn_child` prompt guidelines. Rejected: guidelines describe one tool, and this is a stance for the whole session.
- Let a Jev `stay` verdict stand in `orchestrator`, so the parent does small work itself. Rejected: the prompt would tell the parent to delegate while the launcher refuses `spawn_child`.
- Let `spawn_child` launch despite a Jev `stay` verdict in `orchestrator`. Rejected: the parent would override Jev, against ADR 0008.
- Make orchestrator a third value of Jev routing. Rejected: it merges who owns routing with whether work may stay in the parent.

## Consequences

`orchestrator` is a strong instruction, not a guarantee. The parent may still run a tool itself, and nothing reports it. In `opportunistic`, the parent's system prompt and the gate stay exactly as before this decision, with Jev routing on or off.

With Jev routing on in `orchestrator`, more messages leave, so the unchanged gate blocks the parent's gated tools more often. That block comes from Jev's verdict, not from the mode, so "the mode never blocks" holds only for the mode itself.
