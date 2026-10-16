# Pull Request Playbook

## Commit Structure

Create commits in English with this template. A pull request may carry as many commits as needed. Publishing a pull request never closes or transitions the tracker ticket; closing it stays a separate effect under the approval policy, and no skill or tracker automation closes a specification's parent ticket.

```text
<type>(<scope>): <summary>

<body stating why the change was made>

Refs: <ticket identifier>
```

- `type` is one of feat, fix, refactor, test, docs, chore; the summary is in the imperative.
- The pull request title is in English: the commit header followed by the ticket identifier in parentheses, as in `feat(renewals): add premium calculation (AUT-103)`.
- For branch names and pull request titles, reference the ticket only by its identifier, never with a closing keyword. Commit `Refs:` and the pull request's linked ticket remain required.
- Commits and pull requests carry no attribution trailer or line naming an AI agent, model, or tool.

Commit capability:

- state: supported
- evidence: git 2.55.0; this directory is a Git repository
- provider: git
- limits: signing uses the repository configuration and is not changed
- effects/approval: a local commit follows the approval policy in pull-requests.md
- blocked when: git is unavailable or commit signing fails
- none (confirmed absent): degraded

## When a Skill Says "Create a Pull Request"

Use `GitHub` and create a pull request with:

- Source and proposed destination: under `pull-request` child integration, the source is the child ticket branch and the proposed destination is the parent integration branch. Under `direct`, children integrate locally and only the parent integration branch gets a pull request, proposed against the production base. A standalone ticket proposes the working base. Confirm the destination for each invocation.
- Body: the fixed template below; add no other section.
- Linked ticket and required evidence: the pull request cites the tracker ticket identifier, and how evidence returns to the ticket belongs to `issue-tracker.md`.
- Reviewers, labels, and drafts: open the pull request as a draft with no labels and no reviewers. Ready-for-review, labels, and reviewers are a manual human process.

A missing or unresolved required rule is a blocker for that external effect; do not invent it.

### Pull Request Body

Write the body with these three sections, in this order and with no others, and skip preambles. Use the domain language of the resolved domain authority.

```markdown
## Summary

<diagram, diff-sketch, or tree>

## Evidence

- **Before:** <screenshot/output/failing test run>
  **After:** <screenshot/output/passing test run>

## Merge Danger

**Door:** <one-way or two-way>

**Blast Radius:** <one-word description>
```

- Summary: the smallest view that makes the point, placed beside the sentence it supports — pseudocode, call tree, component or file tree, Mermaid, or a focused `diff`.
- Evidence: the concrete before and after — a screenshot when the change is visual, otherwise the exact test or command output that failed and then passed.
- Merge Danger: the door, one-way when destructive or expensive to reverse and two-way otherwise, plus the blast radius in one word: layout, consumers, deploy, data.

### Branch Capability

- state: supported
- evidence: git branch and origin/main exist
- provider: git
- limits: local branch creation was not executed
- effects/approval: creating a branch follows the approval policy in pull-requests.md
- blocked when: git is unavailable
- none (confirmed absent): degraded

### Push Capability

- state: supported
- evidence: origin tracks the current branch and repository permissions include push
- provider: git
- limits: no push was executed during discovery
- effects/approval: push follows the approval policy in pull-requests.md
- blocked when: push permission is missing or the remote rejects the update
- none (confirmed absent): degraded

### Pull Request Capability

- state: supported
- evidence: gh pr list succeeded; pull request 60 is merged into main
- provider: gh
- limits: no pull request was created during discovery
- effects/approval: opening a pull request follows the approval policy in pull-requests.md
- blocked when: gh is unauthenticated or the GitHub API fails
- none (confirmed absent): degraded

### Review-Thread Capability

- state: supported
- evidence: gh read of pull request 60 review comments and reviews succeeded
- provider: gh
- limits: pull request 60 has no review comments
- effects/approval: posting a review follows the approval policy in pull-requests.md
- blocked when: gh is unauthenticated or the GitHub API fails
- none (confirmed absent): degraded

### CI Capability

- state: supported
- evidence: .github/workflows/ci.yml runs npm run check; job test passed on pull request 60
- provider: GitHub Actions
- limits: ci.yml runs on push and pull requests to main; publish.yml also runs npm run check on release
- effects/approval: read
- blocked when: the workflow is absent or the check fails
- none (confirmed absent): degraded

## Approval Gates and External Effects

The approval policy recorded in `workflow.md` decides which effects wait for the user's explicit approval:

- `every-step`: every effect, local drafts and artifacts included.
- `external-only`: only external effects: a push, a pull request, a comment, an issue or any other tracker change, a merge, and a ticket closure.
- `autonomous`: none; the final report lists each effect with its destination, its action, and its link, not its full text.

A missing or unresolved policy is `every-step`; tell the user once to run `setup-workflow update`. Every level asks before a force-push, before deleting a remote branch, an issue, or a comment, and before any direct write to the production base. A merge into the working base and a ticket closure follow the policy.

The policy governs approvals, not decisions. Where the agent has a grounded recommendation, `autonomous` applies it and records it in the final report; a decision that needs what only the user has, such as product intent, risk acceptance, or a finding that needs the user's intent, is always asked. A sub-agent never asks for approval: it returns its drafts to the orchestrator, which presents them under the policy.

Approval preview: before asking for any approval, show in the conversation the complete literal content, its destination (repository and pull request, ticket, or file path), and the action (create, edit, close, merge, and so on). A question never replaces the content.

Where the policy requires approval, it is per effect, given by the person performing it, and its evidence is preserved with the pull request or its linked ticket. The playbook names no approver. Under `direct` child integration, the batch rule, approved wherever the policy asks, is the approval, and its evidence, for the child-ticket closures it covers; the per-invocation plan `create-pr` requires is that skill's own contract.

## Review and Merge

Review, required checks, and merge of a pull request belong to the pull-request provider: `GitHub` owns branch protection and decides who may merge through the destination branch's permissions. Merge, push, and other remote-state changes follow the approval policy above, including its exceptions at every level.

### Review Capability

- state: supported
- evidence: gh can read pull request reviews; main has no branch protection
- provider: GitHub
- limits: reviews are not required
- effects/approval: submitting a review follows the approval policy in pull-requests.md
- blocked when: gh is unauthenticated or the GitHub API fails
- none (confirmed absent): degraded

### Merge Capability

- state: supported
- evidence: pull request 60 merged into main; repository permissions include admin; main has no branch protection
- provider: GitHub
- limits: no merge was executed during discovery
- effects/approval: merge follows the approval policy in pull-requests.md
- blocked when: permission is missing or the GitHub API fails
- none (confirmed absent): degraded
