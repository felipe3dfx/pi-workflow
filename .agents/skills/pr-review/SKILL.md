---
name: pr-review
description: "Trigger: review a pull request as a whole for a human reviewer, or re-review it after an update. Assess correctness, standards, and decisions, critique the findings, and draft the comment and an APPROVE or REQUEST_CHANGES verdict."
license: MIT
metadata:
  author: "Grupo Ilao"
  version: "1.1"
  provenance: derived
---

# Review a Pull Request

## Activation Contract

Run on an open pull request, whoever built it and however, to prepare a review a human reviewer other than its author can judge, adjust, and publish. It is not a step of the implementation loop and needs nothing that loop produces.

Hold every finding to the requirement and its evidence, so the review keeps the simplification the change already carries.

This skill is read-only. It reads the change without altering the user's checkout, branch, or index, and never edits, fixes, commits, or pushes; publication follows [Publication](#publication). Running tests belongs to CI: never run or validate the suite, add no CI section, and write no routine disclaimer that tests were not run. Tests may be read as evidence.

## Decision Gates

- The pull request, its base, or its head cannot be read: **blocked**. Name what is missing.
- No requirement source resolves for what the change claims to do: ask the user for it before reviewing; never infer the requirement from the code.
- A run never ends in a verdict it could not conclude: a blocked review reports what stopped it and no verdict.

## Sources

Resolve every source from what the repository configures, never assuming a provider, tracker, language, or branch name. When `docs/agents/` exists, `workflow.md` sets precedence, `issue-tracker.md` says how to fetch tickets, `domain.md` names the domain authority and the decision records, `coding-standards.md` holds the repository's own standards, and `pull-requests.md` names the review capability and approval policy. Without them, use the root instruction file and the repository's documentation.

- **Change**: base, head SHA, the diff from their merge-base, changed files, description, and any prior reviews and threads on the pull request.
- **Requirement**: the linked ticket and its specification read fresh from the tracker, else the description or a document the user names.
- **Standards**: [team standards and smell baseline](../code-review/references/standards.md), overridden by the repository's own standards; skip what tooling enforces.
- **Decisions**: decision records the diff adds or modifies, the decision records the domain authority names, and decisions recorded on the ticket or the pull request.

## Execution Steps

1. **Pin** the base, the head SHA, and the commits; every finding refers to code at that head.
2. **Review along three axes.** Each completes its own pass: Correctness when every requirement line maps to code or is reported missing, Standards and Decisions when every changed file has been read. Whether axes run in separate contexts is the harness's choice.
   - **Correctness**: the change against its requirement and as a whole: missing, partial, or wrong behavior, effects on callers and sibling paths that share a changed invariant, and changes outside the requirement's scope.
   - **Standards**: style, the repository's standards, domain rules, architecture, and design quality, from the standards sources only.
   - **Decisions**: each new or modified decision record, and each significant departure from the repository's usual flow, architecture, or standards. Present its documented justification, benefits, costs, risks, and consequences, and what calls for human judgment. Never invent a motivation: say when none is documented. A departure is not wrong by being one, not every decision needs a record, and a defect belongs to the other axes.
3. **Critique** the three axes' results together, after all return. It judges findings, not code, and never reviews again from scratch. For each finding, weigh evidence, context, necessity, impact, and proportionality, then keep it as a blocker or a warning, reclassify it, or discard it, giving the reason. A hypothetical possibility never becomes a requirement; a supported risk is never discarded for being rare. Group confirmed instances of one problem into one finding. Recover prior decisions and critiques when they exist, without requiring them. Keep every important decision visible, defect or not. Close with the Simplification Trade: the single kept risk whose acceptance would remove the most complexity, naming the responsibility behind it, the complexity removed, and whether the remaining failure is silent or loud. It only removes, never trades security, a binding contract, or a requirement, and the human reviewer decides it.
4. **Decide** the verdict: `APPROVE` when the review concluded with no blocker, `REQUEST_CHANGES` when a supported blocker remains. No other verdict exists.
5. **Draft** the comment, the inline comments, and the event, as [the comment format](references/comment-format.md) defines; load it before drafting.

## Later Rounds

When the pull request carries a prior review, verify each of its findings against the current head and read the delta since the head it reviewed, with the code that delta affects; never reopen unchanged code by inertia. List first what is resolved, then classify what remains as not or partially resolved, introduced by the correction, genuinely new, or pre-existing and missed by the previous review. Acknowledge a miss as the previous review's, and judge it in critique on its own evidence.

## Publication

Drafting is not publishing. The run ends with the draft for the human reviewer, who may question the author's decisions, reclassify findings, and edit the draft; recompute the verdict from the final classification. Publish only when the reviewer asks, through the review capability the repository already has, after the approval preview of `pull-requests.md` and under its approval policy; with no recorded policy, use `every-step` and [the shipped rules](../setup-workflow/assets/pull-requests.md#approval-gates-and-external-effects), telling the user once to run `setup-workflow update`.

## References

- Runtime: [comment-format.md](references/comment-format.md), before drafting.
- Maintainer: [worked-rounds.md](references/worked-rounds.md) shows two rounds end to end; a run does not need it.
