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
- The ticket is referenced only by the branch name and the pull request title, never with a closing keyword.
- Commits and pull requests carry no attribution trailer or line naming an AI agent, model, or tool.

Commit capability:

- state: {{COMMIT_CAPABILITY_STATE}}
- evidence: {{COMMIT_CAPABILITY_EVIDENCE}}
- provider: {{COMMIT_CAPABILITY_PROVIDER}}
- limits: {{COMMIT_CAPABILITY_LIMITS}}
- effects/approval: {{COMMIT_CAPABILITY_EFFECTS}}
- degraded: {{COMMIT_CAPABILITY_DEGRADED}}
- blocked when: {{COMMIT_CAPABILITY_BLOCKED_WHEN}}

## When a Skill Says "Create a Pull Request"

Use `{{PULL_REQUEST_PROVIDER}}` and create a pull request with:

- Source and proposed destination: the source is the child ticket branch; the proposed destination is the parent integration branch, or the production base for a parent integration branch.
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

- state: {{PULL_REQUEST_BRANCH_CAPABILITY_STATE}}
- evidence: {{PULL_REQUEST_BRANCH_CAPABILITY_EVIDENCE}}
- provider: {{PULL_REQUEST_BRANCH_CAPABILITY_PROVIDER}}
- limits: {{PULL_REQUEST_BRANCH_CAPABILITY_LIMITS}}
- effects/approval: {{PULL_REQUEST_BRANCH_CAPABILITY_EFFECTS}}
- degraded: {{PULL_REQUEST_BRANCH_CAPABILITY_DEGRADED}}
- blocked when: {{PULL_REQUEST_BRANCH_CAPABILITY_BLOCKED_WHEN}}

### Push Capability

- state: {{PULL_REQUEST_PUSH_CAPABILITY_STATE}}
- evidence: {{PULL_REQUEST_PUSH_CAPABILITY_EVIDENCE}}
- provider: {{PULL_REQUEST_PUSH_CAPABILITY_PROVIDER}}
- limits: {{PULL_REQUEST_PUSH_CAPABILITY_LIMITS}}
- effects/approval: {{PULL_REQUEST_PUSH_CAPABILITY_EFFECTS}}
- degraded: {{PULL_REQUEST_PUSH_CAPABILITY_DEGRADED}}
- blocked when: {{PULL_REQUEST_PUSH_CAPABILITY_BLOCKED_WHEN}}

### Pull Request Capability

- state: {{PULL_REQUEST_CREATE_CAPABILITY_STATE}}
- evidence: {{PULL_REQUEST_CREATE_CAPABILITY_EVIDENCE}}
- provider: {{PULL_REQUEST_CREATE_CAPABILITY_PROVIDER}}
- limits: {{PULL_REQUEST_CREATE_CAPABILITY_LIMITS}}
- effects/approval: {{PULL_REQUEST_CREATE_CAPABILITY_EFFECTS}}
- degraded: {{PULL_REQUEST_CREATE_CAPABILITY_DEGRADED}}
- blocked when: {{PULL_REQUEST_CREATE_CAPABILITY_BLOCKED_WHEN}}

### Review-Thread Capability

- state: {{PULL_REQUEST_REVIEW_THREAD_CAPABILITY_STATE}}
- evidence: {{PULL_REQUEST_REVIEW_THREAD_CAPABILITY_EVIDENCE}}
- provider: {{PULL_REQUEST_REVIEW_THREAD_CAPABILITY_PROVIDER}}
- limits: {{PULL_REQUEST_REVIEW_THREAD_CAPABILITY_LIMITS}}
- effects/approval: {{PULL_REQUEST_REVIEW_THREAD_CAPABILITY_EFFECTS}}
- degraded: {{PULL_REQUEST_REVIEW_THREAD_CAPABILITY_DEGRADED}}
- blocked when: {{PULL_REQUEST_REVIEW_THREAD_CAPABILITY_BLOCKED_WHEN}}

### CI Capability

- state: {{PULL_REQUEST_CI_CAPABILITY_STATE}}
- evidence: {{PULL_REQUEST_CI_CAPABILITY_EVIDENCE}}
- provider: {{PULL_REQUEST_CI_CAPABILITY_PROVIDER}}
- limits: {{PULL_REQUEST_CI_CAPABILITY_LIMITS}}
- effects/approval: {{PULL_REQUEST_CI_CAPABILITY_EFFECTS}}
- degraded: {{PULL_REQUEST_CI_CAPABILITY_DEGRADED}}
- blocked when: {{PULL_REQUEST_CI_CAPABILITY_BLOCKED_WHEN}}

## Approval Gates and External Effects

The approval policy recorded in `workflow.md` decides which effects wait for the user's explicit approval:

- `every-step`: every effect, local drafts and artifacts included.
- `external-only`: only external effects: a push, a pull request, a comment, an issue or any other tracker change, a merge, and a ticket closure.
- `autonomous`: none; the final report lists each effect with its destination, its action, and its link, not its full text.

A missing or unresolved policy is `every-step`; tell the user once to run `setup-workflow update`. Every level asks before a force-push, before deleting a remote branch, an issue, or a comment, and before any direct write to the production base. A merge into the working base and a ticket closure follow the policy.

The policy governs approvals, not decisions. Where the agent has a grounded recommendation, `autonomous` applies it and records it in the final report; a decision that needs what only the user has, such as product intent, risk acceptance, or a finding that needs the user's intent, is always asked. A sub-agent never asks for approval: it returns its drafts to the orchestrator, which presents them under the policy.

Approval preview: before asking for any approval, show in the conversation the complete literal content, its destination (repository and pull request, ticket, or file path), and the action (create, edit, close, merge, and so on). A question never replaces the content.

Approval is per effect, given by the person performing it, and its evidence is preserved with the pull request or its linked ticket. The playbook names no approver. Under `direct` child integration, the batch rule, approved wherever the policy asks, is the approval, and its evidence, for the child-ticket closures it covers; the per-invocation plan `create-pr` requires is that skill's own contract.

## Review and Merge

Review, required checks, and merge of a pull request belong to the pull-request provider: `{{PULL_REQUEST_PROVIDER}}` owns branch protection and decides who may merge through the destination branch's permissions. Never merge, push, or change remote state without the applicable approval.

### Review Capability

- state: {{REVIEW_CAPABILITY_STATE}}
- evidence: {{REVIEW_CAPABILITY_EVIDENCE}}
- provider: {{REVIEW_CAPABILITY_PROVIDER}}
- limits: {{REVIEW_CAPABILITY_LIMITS}}
- effects/approval: {{REVIEW_CAPABILITY_EFFECTS}}
- degraded: {{REVIEW_CAPABILITY_DEGRADED}}
- blocked when: {{REVIEW_CAPABILITY_BLOCKED_WHEN}}

### Merge Capability

- state: {{MERGE_CAPABILITY_STATE}}
- evidence: {{MERGE_CAPABILITY_EVIDENCE}}
- provider: {{MERGE_CAPABILITY_PROVIDER}}
- limits: {{MERGE_CAPABILITY_LIMITS}}
- effects/approval: {{MERGE_CAPABILITY_EFFECTS}}
- degraded: {{MERGE_CAPABILITY_DEGRADED}}
- blocked when: {{MERGE_CAPABILITY_BLOCKED_WHEN}}
