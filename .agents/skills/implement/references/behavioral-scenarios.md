# Behavioral Scenarios

A maintainer reference: a run does not need this file. Check every change to `implement`'s entry gate, Work Contract, defect diagnosis, or branch rules against each scenario below; a change that alters an expected outcome needs a decision record.

| Scenario | Expected outcome |
| --- | --- |
| Standalone Ticket, no specification, sufficient Work Contract | The contract is approved, then the run proceeds to Seams. |
| Standalone Ticket with no recoverable verification | **blocked**, naming verification, what was investigated, and where. |
| A gap the code, a decision record, the domain authority, or a playbook answers | Completed without asking and recorded in the contract with its source; not an addition, so no comment and no extra approval. |
| The Work Contract adds behavior or scope beyond the ticket and specification | Published as an issue comment after its approval; the Spec axis judges the diff against it. |
| Child Ticket with a specification | Unchanged: a material contradiction with the specification blocks. |
| Ticket published by `to-tickets`: a native child of a parent that cites a readable specification | Enters as published, with no separate contract approval. |
| Doubtful publisher, or a tracker without native relationships | Enters through its Work Contract approved under the approval policy. |
| Native child whose parent cites a specification that cannot be read | **blocked**, naming the specification; it never enters as published. |
| Child Ticket without a specification, not published by `to-tickets` | The contract comes from the ticket and is approved under the approval policy; the branch starts from the parent's integration branch. |
| Branch timing | Proposed and created right after the ticket is read, before the Work Contract is built; the developer may change it. |
| Standalone Ticket branch | Proposed from the working base, never the production base; `create-pr` proposes the working base as the destination. |
| Child of `implement-spec` in `direct` mode | Unchanged; works on the branch that run created, without proposing or creating one. |
| `autonomous` approval policy | The contract is recorded in the handoff, with no pause. |
| Defect ticket whose root cause is not established | `diagnose-bug` runs on the ticket's branch before Seams, with `git bisect` and cross-version runs only in a scratch checkout; the root cause and reproduction are recorded in the Work Contract with the defect diagnosis as their source, not as an addition, and step 1 proposes the regression seam. |
| Diagnosis loop is a human-in-the-loop script | Its first run and its rerun are questions to the developer, who runs the script in a separate terminal and reports its exit status, even under `autonomous`; the rerun is green when the developer reports exit 0; any `git bisect` over it is run whole by the developer, also under `autonomous`; as a child of `implement-spec`, it is returned to that run. The loop's files are removed before the step 3 checkpoint commit. |
| Defect ticket that states its root cause | No diagnosis; the run proceeds as for any ticket. |
| Ticket that reports no defect | Unchanged: no diagnosis. |
| `diagnose-bug` cannot build a red-capable loop | **blocked**, naming what was tried and what is needed. |
| The diagnosed root cause lies outside the ticket's scope | A scope expansion the developer decides; the run never widens scope on its own. |
| Repository gate | `uv run --frozen pre-commit run --all-files` is green, and the `SKILL.md` body stays within 1,000 words. |
