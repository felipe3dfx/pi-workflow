# ADR 0027: The parent owns delegation without Jev routing

## Status

Acceptance: approval and merge of the introducing PR.

## Decision

Issue: #352.

Supersedes: ADR-0008 (its routing-ownership decision: the parent is now always the owner); ADR-0015 (only its clauses that depend on Jev routing: storage beside Jev routing, independence from the routing owner, the narrower orchestrator `stay` criterion, and the tool gate that does not change with the mode); ADR-0017 (only its Jev destination and Tool gate clauses; its uniform child context clause stays in force); ADR-0018 (only its leave-block message and routed-read clauses; procedure discovery and obligation tracking stay as parent instructions).

Jev routing is removed from the product. No classifier is consulted to decide where the work of a user message goes, and nothing gates the parent's tools. The parent session alone decides whether to delegate and supplies the child role for each launch.

`spawn_child` with a valid role (`explore`, `worker`, `verify`) launches under that role's contract. `spawn_child` without a role is refused with a message that asks for one; it never assumes `worker`. There is no stay, decide, or blocked outcome.

The `/workflow:config` Jev routing row and the `/workflow:delegation-check` command are removed. A `pi-workflow-routing.json` left in the agent directory is neither read nor deleted.

Delegation mode is unchanged and is the only delegation guidance: `orchestrator` instructs the parent through its system prompt, as ADR-0015 decided.

## Considered Options

- Patch the destination criteria so that a procedure the parent must direct stays in the parent for its first step. Rejected: it takes three coordinated changes guarded only by an opt-in live test, and the previous criteria patch caused this defect.
- Let a `stay` verdict permit launches. Rejected: it keeps a classifier that sees only the raw user text deciding over a parent that sees the procedure, and keeps the gate that blocks the parent's reads.
- Remove Jev routing and leave delegation to the parent. Chosen.

Evidence: with the gate's request shape, the live classifier answered `leave` 8 of 8 times to «revisa el pr 3330» because of the independent-review clause added for #164. With that clause removed it answered `stay` 8 of 8 times. `leave` blocks the parent's reads, including the procedure's `SKILL.md`, until a child launches; `stay` refuses every `spawn_child` for that message. Neither verdict lets the parent read a procedure and then launch the children it prescribes.

## Consequences

Delegation is guided by the prompt only. Nothing enforces it: in `orchestrator` the parent may still do work itself, and nothing reports it.

A TypeSafe key is no longer needed for delegation. Launch refusals that remain are local checks, such as an unknown or missing role, a refused model profile, an invalid worktree, or the Launch limit.

Child contracts, per-role tools, the child `bash` guard for `git` and `gh`, checkpoints, and the contextual authorization classifier are unchanged.
