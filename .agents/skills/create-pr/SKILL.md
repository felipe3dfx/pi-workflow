---
name: create-pr
description: "Trigger: publish a locally committed ticket candidate: push, draft pull request, relationships, and Spanish ticket comment. Verify commit and title conventions, approve each effect, and reconcile without duplicating effects."
license: MIT
metadata:
  author: "Grupo Ilao"
  version: "2.2"
  provenance: original
---

# Create a Pull Request

## Activation Contract

Publish a candidate that is already committed. For a child ticket, consume the `implement` handoff, which names the ticket, the branch, and the commit SHAs. For a parent integration branch, consume a parent publication handoff from the developer or `implement-spec` that names the parent ticket, the branch, its production base, the head SHA, the commits since that base, and the coverage evidence: the `code-review` report on that branch against its specification. Also consume the consumer workflow, pull-request, and issue-tracker playbooks. The playbooks own the commit template, the title rule, the pull-request body, the providers, and the recorded bases; consume them rather than restating them.

Perform only the requested subset of these effects: push the branch, open the draft pull request, record the ticket and parent relationships, and append the Spanish ticket comment. Commits come from `implement`; this skill never creates, amends, squashes, or rewrites one.

## Decision Gates

Resolve the candidate from repository state: the branch, its commits since the base, and its head SHA must match the handoff. A mismatch, an uncommitted change inside the candidate, or a missing commit returns to the handoff's owner: `implement` for a child ticket, the developer for a parent integration branch. A parent publication handoff without a coverage report for its current head, or with an unresolved missing-requirement finding, blocks publication.

Under `pull-request` child integration, when more than one child of the same parent is open, run an integration check before publishing a child: apply every open sibling head onto the parent integration branch in a scratch copy, then run the full validation gate. A failure returns to `implement` for the tickets involved.

The merge destination is an explicit input on every invocation. Propose it from the recorded bases and the playbook's branch rule, and have the user confirm it. A destination that differs from the recorded value is a decision, never a reason to refuse.

Before any effect, verify the drafted pull-request title against the playbook's title rule. Verify every commit's signature: a merge commit the provider created when merging a child pull request against the provider's signing key, every other commit against the repository's existing signing configuration. Verify each commit's message against the fixed template; on a parent integration branch, only those provider merge commits are exempt from the template, and every other commit is checked, including one made directly on the parent. Verify that no commit and no part of the pull request carries an attribution naming an AI agent, model, or tool. Report every mismatch to its owner: `implement` for a child ticket's commits, the developer for a commit made on the parent, and the user for the title. Never rewrite a message or a title silently.

When the candidate adds or renames a decision record with a four-digit prefix, check the combined target: capture the confirmed destination's commit OID and verify that no prefix or exact path in the candidate collides with one on that target. Bind the result to that OID and recheck it immediately before the push and before opening the pull request; a moved target invalidates it. A collision blocks publication and is reported; never renumber.

A missing or `requires-setup` capability the playbooks mark as required blocks its effect; use only a degraded path they document.

## Plan and Execution

Draft the pull-request title, the body using the playbook's three sections and no other, the source and confirmed destination, the relationships, and the append-only Spanish ticket comment that links the pull request and its evidence and never changes the ticket's state. The pull request opens as a draft with no labels and no reviewers. Present one plan listing every external effect the approval policy gates, each as its approval preview, and obtain explicit approval for each; a material change to content, operation, or destination needs a revised approval. Approvals follow the pull-request playbook's approval policy and approval preview; with no recorded policy, use `every-step` and [the shipped rules](../setup-workflow/assets/pull-requests.md#approval-gates-and-external-effects), telling the user once to run `setup-workflow update`.

Before each approved effect, revalidate its inputs against current repository and provider state: head SHA, remote refs, destination OID, and the decision-record check. After the push, confirm the remote branch points at the planned head SHA; after opening the pull request, confirm its source, destination, and draft state.

After a failure, cancellation, concurrent change, or uncertain provider result, stop mutating. Preserve local commits and completed effects. Reconcile authoritative repository, provider, and tracker state, identify each completed operation, and never retry or duplicate an uncertain effect. Resume only a still-valid approved plan. Recovery that rewrites history, rolls back, or destroys anything needs its own approved plan under consumer policy.

## Output Contract

Report in prose:

- each effect performed with its identity: pushed commit SHAs and head SHA, the pull-request URL, the comment's link;
- each verification result, including any convention mismatch and who owns it;
- what is pending, unapproved, blocked, or uncertain, and why;
- the next action: `qa-impact` on the pushed head SHA, and again on every new head.

Publication is complete only when every requested effect is confirmed; a partial or unknown result is reported as incomplete.
