---
name: code-review
description: "Trigger: review a ticket's diff inside the implementation loop, or a parent integration branch against its specification. Report Standards, Spec, and Valuable Tests findings side by side."
license: MIT
metadata:
  author: "Grupo Ilao"
  version: "2.4.0"
  provenance: derived
---

# Review Code Changes

## Activation Contract

Run once per implementation loop, after the build and before critique, in a context other than the implementer's. Review the diff since a fixed point along three axes, each in its own isolated context, and hand the report to `review-critique`.

The fixed point is the ticket's base for a child ticket. For a parent integration branch reviewed against its specification, it is the production base. The diff runs from the merge-base of the fixed point to the current state, committed and uncommitted.

This skill never changes the reviewed tree. It reads the diff, the files around it, and the sources each axis names, and runs tests only in a scratch checkout. It never edits, fixes, comments, commits, or publishes.

## Decision Gates

- The fixed point does not resolve: **blocked**. Name the ref.
- The diff is empty: report that there is nothing to review and stop.
- The ticket, or the specification for a parent integration branch, cannot be read: **blocked**. Name what is missing.
- The harness cannot provide three isolated contexts: **blocked**. Ask the harness for them; never run two axes in one context, and never run an axis in the reviewer's own context.
- The Valuable Tests axis is **blocked** as [scratch evidence](references/scratch-evidence.md) defines it; Standards and Spec still report.

## Execution Steps

1. Pin the fixed point. Record the fixed point, the current head, the commit list since the fixed point, and whether uncommitted changes are included.
2. Collect each axis's sources: for Standards, [team standards and smell baseline](references/standards.md) and the repository's `docs/agents/coding-standards.md` when it exists; for Spec, the ticket and its specification for a child ticket, or the specification and every child ticket for a parent integration branch, read fresh from the tracker, plus the published decision comments, never a scope note written by whoever invoked the review; for Valuable Tests, [the valuable-tests rubric](../tdd/references/valuable-tests.md), the scratch evidence file, the repository's `docs/agents/quality.md`, and the seams and coverage lines agreed before the first test, taken from the requirement-tracing table or coverage lines its caller hands over (or else from the ticket), plus the ticket, or every child ticket for a parent integration branch, read fresh from the tracker to check those tables against.
3. Dispatch each axis to its own context, in parallel when the harness allows. Give each one the fixed point, the head, the commit list, its own sources by path, and its brief below. An axis receives no other axis's sources or findings.
4. Assemble the report from the three axis reports, verbatim or lightly cleaned.

### Standards brief

Read only the team standards shipped with the skill and the repository's `docs/agents/coding-standards.md` when present; do not mine other repository documents for standards. Report every broken standard and every baseline smell, quoting the hunk, classified as the standards file says.

### Spec brief

Report requirements that are missing or partial, behavior the diff adds that the ticket or specification did not ask for, and requirements implemented wrongly. Quote the ticket or specification line for each finding. For a parent integration branch, confirm every child ticket's requirement is present.

### Valuable Tests brief

Run each test file the diff adds or changes, whole, against the fixed point's production code, in a scratch checkout prepared and classified as the scratch evidence file says. Apply the rubric to every test the diff adds or changes: tautological tests, structure-sensitive tests, and mocks that hide failure or verify through a side channel. Also report a behavior the diff changes that has no test at its agreed seam, unless a no-valuable-test-seam exception is recorded. Name the failure mode for each finding. A finding is `hard` when a behavior agreed at a seam has no test, or its test cannot fail, including one that passes against the fixed point; every other rubric tell is `judgement`. A test skipped at an agreed seam never counts as passing: report it with its reason as that seam having no test, even where an exception is recorded; a pertinent case planned in a coverage line with no test, or only a skipped one, and a ticket requirement with no line in a handed-over tracing table are `hard` findings.

## Output Contract

Prose, under three headings in this order: `## Standards`, `## Spec`, `## Valuable Tests`. Open with the fixed point, the head, and whether uncommitted changes were included. `## Valuable Tests` opens with the scratch record: the candidate's identity before and after, and each file's outcome classes. When one axis runs on its own, return only its own section, with that opening line and its count line.

Each finding carries:

- a stable ID: `STD-n`, `SPEC-n`, or `TEST-n`, numbered within its axis; a later review in the same loop continues the numbering and never reuses an ID;
- `hard` or `judgement`;
- a repository-relative path with a line in the reviewed version (the head, plus uncommitted changes when included), or the ticket or specification line when the finding is a missing requirement or a missing test at an agreed seam;
- the claim, in one sentence;
- the evidence: the quoted hunk, plus the standard, the ticket or specification line, or the rubric failure mode it breaks.

An axis with nothing to report says so in one line, and says why when the diff gave it nothing to review, such as a diff without tests.

Never merge findings across axes, rerank them, or pick a single worst finding. End with one line giving the finding count per axis and the most serious finding within each axis.
