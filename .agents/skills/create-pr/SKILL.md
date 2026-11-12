---
name: create-pr
description: "Trigger: publish a locally committed ticket candidate: publication gate on the exact head, push, draft pull request, relationships, and Spanish ticket comment. Verify conventions, approve each effect, and reconcile without duplicating effects."
license: MIT
metadata:
  author: "Grupo Ilao"
  version: "3.11"
  provenance: original
---

# Create a Pull Request

## Activation Contract

Publish a candidate that is already committed. For a ticket, consume the `implement` handoff, which names the ticket, the branch, the commit SHAs, and the review report for its head. For a parent integration branch, consume a parent publication handoff from the developer or `implement-spec` that names the parent ticket, the branch, its production base, the head SHA, the commits since that base, and the coverage evidence: the `code-review` report on that branch against its specification. Also consume the consumer workflow, pull-request, and issue-tracker playbooks. The playbooks own the commit template, the title rule, the pull-request body, the providers, and the recorded bases; consume them rather than restating them.

Perform only the requested subset of these effects: push the branch, open the draft pull request, record the ticket and parent relationships, and append the Spanish ticket comment. Commits come from `implement`; this skill never creates, amends, squashes, or rewrites one.

## Decision Gates

Resolve the candidate from repository state: the branch, its commits since the base, and its head SHA must match the handoff. A mismatch, an uncommitted change inside the candidate, or a missing commit returns to the handoff's owner: `implement` for a ticket, the developer for a parent. A handoff without a `code-review` report for the exact head it publishes, or with an unresolved missing-requirement finding, blocks publication and returns to its owner. A report whose only block is accepted missing evidence counts as that report.

Before every push, read [the publication gate](references/publication-gate.md) to select the gate by the change's impact, and run it on the exact head being pushed, with quiet output, publishing only on green. Whenever the gate is the full class, read [an interrupted full-class run](references/full-validation.md) before running it. Each round's handoff carries the consecutive red-run count and the last green pushed head with its class; only a green run resets the count.

Never apply a fix or feedback on the change itself; only drafts (title, body, destination, relationships, comment) are adjusted here. A red gate publishes nothing; its failures and developer feedback on the change, even during the preview before the first push, return to that owner as a new round, in `implement-spec`'s fix step for a parent. Never wait for CI: red CI the developer shows the change caused returns the same way; other red CI stays with the developer. The corrected head returns as a new handoff.

The merge destination is an explicit input on every invocation. Propose it from the recorded bases and the playbook's branch rule, or the working base for a Standalone Ticket, and have the user confirm it. A destination that differs from the recorded value is a decision, never a reason to refuse.

Before any effect, verify the drafted pull-request title against the playbook's title rule. Verify each commit's message against the fixed template; on a parent integration branch, a merge commit verifying against the provider's signing key is an exempt provider merge; every other commit is checked, including a merge failing that check and one made directly on the parent. No signature blocks on its own. Verify that no commit and no part of the pull request carries an attribution naming an AI agent, model, or tool. Report every mismatch to its owner: `implement` for a ticket's commits, the developer for a commit made on the parent, and the user for the title. Never rewrite a message or a title silently.

When the candidate adds or renames a decision record with a four-digit prefix, read [the decision-record check](references/decision-record-check.md) before the first effect.

A missing or `requires-setup` capability the playbooks mark as required blocks its effect; use only a degraded path they document.

## Plan and Execution

Draft the pull-request title, the body using the playbook's three sections and no other, with the handoff's accepted risks copied verbatim into its evidence section, never stated as passed, the source and confirmed destination, the relationships, and the ticket comment per the tracker playbook: the pull-request link plus one or two lines on what the reader will see change, never changing ticket state. The pull request opens as a draft with no labels and no reviewers. Present one plan listing every external effect the pull-request playbook's approval policy gates, each as its approval preview, and obtain explicit approval for each; a material change to content, operation, or destination needs a revised approval. With no recorded policy, use `every-step`, telling the user once to run `setup-workflow update`; with no pull-request playbook, block and point to `setup-workflow`.

Before each approved effect, revalidate its inputs against current repository and provider state: head SHA, remote refs, destination OID, and the decision-record check. After the push, confirm the remote branch points at the planned head SHA; after opening the pull request, confirm its source, destination, and draft state.

After a failure, cancellation, concurrent change, or uncertain provider result, stop mutating and read [recovery](references/recovery.md).

## Output Contract

Report in prose:

- each effect performed with its identity: pushed commit SHAs and head SHA, the pull-request URL, the comment's link;
- on each pushed head, the Gate Base chosen and why, the publication gate class selected, why, and its result, and the count of consecutive red runs;
- each verification result, including any convention mismatch and who owns it;
- what returned to its owner as a new round, and why;
- what is pending, unapproved, blocked, or uncertain, and why;
- the next action: `qa-impact` on the pushed head SHA, and again on every new head, its draft published as the ticket's single QA comment per its output contract.

Publication is complete only when every requested effect is confirmed; a partial or unknown result is reported as incomplete.
