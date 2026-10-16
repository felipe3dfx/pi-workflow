# Work Contract

Read this file in full right after reading the ticket. It defines where the ticket's branch starts, how the run builds and approves the Work Contract, and when a defect is diagnosed first.

## Sources and authority

The Work Contract states the ticket's expected outcome, scope, constraints, and verification, each element traced to its source: the ticket, a specification, a decision record, the domain authority, a playbook, the code, or a defect diagnosis. Specification and parent are independent: a ticket may have both, either, or neither.

- A specification, when one exists, is the contract's authority. No other source overrides it, and a material contradiction with it blocks as the decision gates say. A specification the ticket or its parent names that cannot be read: **blocked**, naming it.
- A parent, when one exists, decides only the branch base.

## Defect diagnosis

When the ticket reports a defect and neither it nor its specification establishes the root cause, load the `diagnose-bug` skill on the ticket's branch while building the contract, before its approval and before step 1.

- Input: the reported symptom and reproduction details, the domain authority, and the decision records for the area.
- Output: the proven root cause with its evidence, the minimised reproduction, the original loop command with its uncommitted files and whether it needs a human, and the correct regression seam or the no-correct-seam finding.
- The output feeds the contract: scope names the root cause to fix, and verification requires the original loop rerun green, exiting 0 (for a human-in-the-loop rerun, the exit status the developer reports), after GREEN, its files then removed before the step 3 checkpoint commit and, at a correct seam, the minimised reproduction as the regression test. These elements are recorded with their source, the defect diagnosis; they are not an addition and need no comment or approval of their own. Step 1 proposes the regression seam; a no-correct-seam finding is presented there, where `tdd`'s seam rules decide.
- Every diagnosis step that needs the developer, the first human-in-the-loop run or its rerun, is a question: ask it even under `autonomous`, since only the developer can run the script in a separate terminal and report its exit status; with a human-in-the-loop loop the developer also runs the whole `git bisect`, even under `autonomous`; and as a child of `implement-spec`, return it to that run like any other question.
- Authority: the diagnosis establishes cause only. It never changes the ticket's expected behavior or scope beyond fixing that cause; a root cause outside the ticket's scope is a scope expansion the developer decides.
- A blocked diagnosis blocks the ticket, naming what was tried and what is needed.

A ticket that states its root cause, or that reports no defect, skips this section.

## Sufficiency

The contract is sufficient when every element is stated and traced. Before asking anything, investigate each gap in the ticket, the specification, the decision records, the playbooks, the domain authority, and the code. Complete a gap those sources answer without asking, tracing the element to its source. Ask only for a decision or for information no source holds.

An element still missing after that investigation makes the contract insufficient: **blocked**, naming the missing element, what was investigated, and where. When the developer's answer completes it, present the contract for approval and continue.

## Approval

This is an entry gate, never a new responsibility: the run never rewrites or prepares the ticket itself.

The gate depends on who published the ticket, not on whether it has a parent.

- A ticket published by `to-tickets` enters as published: that publication approves a contract whose behavior and scope come from its ticket and specification. A ticket counts as published by `to-tickets` only when it is a native child of a parent that cites a readable specification, the footprint `to-tickets` guarantees and reads back.
- Any other ticket, a Standalone Ticket or a Child Ticket `to-tickets` did not publish, enters through its Work Contract approved under the approval policy: present the contract as an approval preview before step 1. A doubtful case, including a tracker without native relationships, is treated as any other ticket.
- An element traced to the code, a decision record, the domain authority, a playbook, or a defect diagnosis is recorded in the contract with its source; it is not an addition and needs no comment or approval of its own, so a ticket published by `to-tickets` still enters as published.
- Behavior or scope beyond the ticket and specification, whether proposed from a source or answered by the developer, is a Work Contract addition for any ticket: it goes through approval and is published as the append-only Spanish issue comment SKILL.md requires, before step 1, so the Spec axis judges the diff against it.

Under `autonomous`, record the contract in the handoff and continue without pausing. As a child of `implement-spec`, return the contract and any comment draft to that run.

## Branch

Propose the branch, which the developer may change, and create it as soon as the ticket is read, before building the Work Contract: its base depends only on the parent. As a child of `implement-spec`, neither propose nor create one: work on the branch that run created. Name it per the recorded child branch naming convention, and never start it from the production base.

- A Child Ticket's branch starts from its parent's integration branch.
- A Standalone Ticket's branch starts from the recorded working base. When the naming convention includes a parent's identifier, use the ticket's identifier alone. The handoff names the working base, and `create-pr` receives it as the proposed destination. The `direct` child integration mode does not apply.

Maintainers changing these rules check them against [the behavioral scenarios](behavioral-scenarios.md); a run does not need that file.
