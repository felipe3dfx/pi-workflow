# ADR 0027: The parent owns delegation without Jev routing

## Status

Acceptance: approval and merge of the introducing PR.

Amended by [ADR 0028](0028-parent-evidence-budget.md): Delegation mode stays the only persistent delegation stance, but no longer the only delegation guidance; the `spawn_child` preparation contract and the advisory exploration-budget notice join it.

## Decision

Issue: #352.

Supersedes: ADR-0008 (its routing-ownership decision: the parent is now always the owner); ADR-0009 (only its clause that the tool gate and the launcher share one chooser verdict per operator message); ADR-0012 (only its Jev routing row of the `/workflow:config` menu; the single command entrypoint stays in force); ADR-0014 (only its clause that the parent's Tool gate does not reach a child); ADR-0015 (only its clauses that depend on Jev routing: storage beside Jev routing, independence from the routing owner, the narrower orchestrator `stay` criterion, and the tool gate that does not change with the mode); ADR-0017 (only its Jev destination and Tool gate clauses; its uniform child context clause stays in force); ADR-0018 (only its leave-block message and routed-read clauses; procedure discovery and obligation tracking stay as parent instructions); ADR-0020 (only its clause that the launch is refused before Jev is asked; the checkpoint grant stays in force as local checks); ADR-0021 (only its composition of contextual authorization with destination routing, where Jev stays destination-only and authorization never overrides its destination block); ADR-0022 (only the destination-only Jev item of its preserved obligations).

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

In a resumed session recorded before the removal, parent tool calls that the gate had blocked render as ordinary failed tool calls instead of routing rows, and their stored `pi-workflow-routing-block` entries are ignored.

Child contracts, per-role tools, the child `bash` guard for `git` and `gh`, checkpoints, and the contextual authorization classifier are unchanged.
