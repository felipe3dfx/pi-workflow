# Behavioral Scenarios

A maintainer reference: a run does not need this file. Check every change to `implement`'s entry gate, Work Contract, defect diagnosis, branch rules, review stops, or signing against each scenario below; a change that alters an expected outcome needs a decision record.

| Scenario | Expected outcome |
| --- | --- |
| A supplied reference resolves to exactly one ticket | The canonical identifier, title, and repository or project are shown before the branch is created; no confirmation is asked and the run continues. |
| A supplied reference is ambiguous, such as a bare number that matches tickets in two repositories | One focused question, before any branch is created; the run never picks one. |
| The request names more than one ticket | Unchanged: **blocked**. |
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
| Child of `implement-spec` at a step 3 checkpoint | The child creates the checkpoint on its branch and returns the committed SHA with its evidence; `implement-spec` never creates it. |
| Child of `implement-spec` whose harness cannot authorize the checkpoint commit | **blocked**, reporting the missing capability; the checkpoint is never handed to the parent and the guard is never bypassed. |
| Before the first test, entry and build prerequisites satisfied, supported focused validation but unsupported Scratch Evidence; harness says "An unmet mandatory prerequisite stops dependent work; do not continue it as qualified partial work." | Tell the developer once that Valuable Tests will block at Review and publishing will need that risk accepted; the notice never blocks. Proceed through TDD, focused Build, and Checkpoint. Mandatory scratch evidence remains pending for Review, not satisfied or bypassed. |
| Step 4 with unsupported Scratch Evidence, no usable degraded path, committed candidate, resolvable fixed base, readable sources, and isolated review contexts | Valuable Tests is **blocked** under its scratch evidence contract; Standards and Spec still report. Ask the developer one question: accept the risk and continue to the handoff, or stop; on acceptance, Critique and Fix run as usual. Preserve candidate identity and scratch isolation obligations. |
| Missing focused validation path, or focused checks fail during Build, regardless of Scratch Evidence availability | Missing focused validation blocks entry and points to `setup-workflow`; failed focused checks require recovery and never permit Checkpoint or a complete handoff while red. |
| Developer asks to ignore unsupported Scratch Evidence | The Review gate still runs and Valuable Tests reports **blocked**; the request is the answer to the risk question, never a relabel of the capability as supported. The acceptance is published as the accepted-risk issue comment under the approval policy, carried in the handoff's accepted risks, and holds for the ticket while the cause is unchanged; a different cause, such as a scratch setup failure, asks again. |
| Scratch Evidence unsupported, focused checks green, developer explicitly asked to publish a draft without more review | Valuable Tests is **blocked**; Standards and Spec report. The instruction answers only the risk question: the risk question is not asked again, the accepted-risk comment still goes through its approval preview where the policy asks, and Critique and Fix still run on the findings, steps 5–6, before the handoff; the handoff to `create-pr` carries the accepted risk and never reports the change as reviewed or approved. |
| Accepted missing evidence with a hard finding without a verdict, no `code-review` report for the head, or red focused checks | Not complete; the acceptance covers none of these, nor `create-pr`'s publication gate, and scratch never runs on shared databases or services without recorded isolation. |
| `supported` Scratch Evidence, Valuable Tests blocks at Review on a scratch setup failure or shared state touched without recorded isolation | The run reads the missing-evidence rules at Review and asks the risk question; no early notice was given. An acceptance of an earlier, different cause does not cover it. |
| Valuable Tests blocks because the candidate identity changed during the scratch runs | Never accepted as a risk, even after an explicit publish instruction; the committed head is reviewed again. |
| Unsigned head in a repository without signing configured | One warning per ticket suggesting the developer configure signing; nothing blocks. |
| Commit fails under configured signing | The failure is surfaced as is; it is never bypassed with `--no-gpg-sign` or a configuration change. |
| Repository gate | `uv run --frozen pre-commit run --all-files` is green, and the `SKILL.md` body stays within 1,000 words. |
