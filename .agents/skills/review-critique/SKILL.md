---
name: review-critique
description: "Trigger: judge code-review findings inside the implementation loop. Verify each finding against the files and return one verdict per finding: accepted with a fix, rejected with evidence, or user decision, then close with a Simplification Trade."
license: MIT
metadata:
  author: "Grupo Ilao"
  version: "3.2.0"
  provenance: original
---

# Critique Review Findings

## Activation Contract

Run after `code-review` and before any fix, as its adversary. Consume its report together with the diff it names, the ticket or specification, the seams agreed before the first test, and the decisions recorded for the work. Only the findings this run accepts are applied.

Judge the findings, not the code. The output covers exactly the findings received; a problem noticed outside them goes unreported here. In a corrective report, judge only the new findings: a prior finding keeps its verdict. When handed a register of findings earlier reviews rejected or the developer decided, a finding that matches an entry, the same claim at the same location or requirement, keeps that entry's verdict and developer decision; only a finding that reopens an entry with new cited evidence is judged afresh.

Dispose of every ordinary finding here, without asking the developer between reviews; when the loop closes, only the `user decision` findings, the last critique's trade among them, and the accepted findings still open reach the developer. A `user decision`, the trade included, is a proposal, not an accepted risk, so it never stops the loop before it closes.

This skill is read-only. It never edits, fixes, comments, commits, or publishes.

## Decision Gates

- The report lacks an axis heading, or a finding lacks its ID or its location (a `file:line`, or a ticket or specification line): **blocked**. Name what is missing and return the report to `code-review`.
- An axis reported that it had nothing to review: accept that and judge the other findings.

## Critique Procedure

For each finding, in the report's order:

1. Open the cited location in the reviewed head, or the cited ticket or specification line, and confirm the quoted evidence is there.
2. Confirm the cited authority says what the finding claims: the standard, the ticket or specification line, or the rubric failure mode.
3. Test the finding itself. The problem must be in code the diff introduced or changed, or be a requirement or agreed-seam test the diff omits. It must have a concrete effect in this diff; a judgement call names the effect the diff itself causes or fails. A limit already breached at the fixed point is judged only by what the diff worsens. A finding already covered by another finding is rejected as a duplicate of the retained ID. A correction out of proportion to its impact is rejected with that evidence, but a supported risk is never rejected for being rare: a risk to security, a binding contract, or a ticket requirement stays accepted, never rejected as out of proportion, and any other whose correction adds complexity is a `user decision` offered with the simplification it allows.
4. Shape the fix. Choose the simplest change that closes the problem. A fix that adds speculative abstraction, configuration, a fallback, or a backward-compatibility layer is replaced with a simpler one, or the finding is rejected when no simpler fix exists.
5. Assign exactly one verdict:
   - **accepted**: the finding holds. State the concrete fix: the file, the change, and the expected result, precise enough that a context without this conversation can apply it.
   - **rejected**: the finding fails a check above. State the evidence: the `file:line`, the quoted line, or the authority that refutes it.
   - **user decision**: the finding holds, but acting on it would change something the developer explicitly agreed, such as a test seam, a recorded decision, or a trade-off between binding requirements, or the finding is a rare supported risk whose correction adds complexity, as step 3 defines. State the trade-off in one line. The developer's answer, not this run, decides the finding.

## Simplification Trade

After the verdicts, answer two questions about the accepted set as a whole: is this the simplest sufficient change, and which single risk, if accepted, would remove the most complexity?

Name those findings by ID, the responsibility that generates them, the complexity removed, and whether the failure left behind is silent or loud. When the new findings come from what the previous fix added, propose shrinking that change instead of patching it. The trade only proposes removing, never adding, and never trades a risk to security, a binding contract, or a ticket requirement. Report it as one more `user decision` entry with the ID `TRADE`, which a corrective critique's trade, or its `Trade: none`, replaces. When no risk qualifies, write the single line `Trade: none`.

## Output Contract

Prose, one entry per finding in the review's order, each opening with the finding's ID unchanged, then its verdict and the fix, evidence, or trade-off the verdict requires. Every finding gets exactly one entry.

End with one line listing the accepted IDs, as in `Accepted: STD-2, TEST-1`, or `Accepted: none`; for a corrective report, add one line listing the prior accepted findings it carries as still open, as in `Open: TEST-1`, or `Open: none`. Then list each rejected finding for the developer as its ID, `rejected`, and a one-line reason; it needs no answer.

Close with the `TRADE` entry, or `Trade: none`.
