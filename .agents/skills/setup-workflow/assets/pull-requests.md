# Pull Request Playbook

## Commit Structure

Create commits according to `{{COMMIT_CONVENTION}}`. A pull request may carry as many commits as needed. Publishing a pull request never closes or transitions the tracker ticket; closing it stays a separate human decision.

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

- Source and proposed destination: `{{PULL_REQUEST_BRANCH_RULES}}`
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

Approval is per effect: every external effect requires the explicit approval of the person performing it, and approval evidence is preserved with the pull request or its linked ticket. The playbook records no standing approval and no named approver; the per-invocation plan `create-pr` requires is that skill's own contract.

## Review and Merge

Review, required checks, and merge belong to the pull-request provider: `{{PULL_REQUEST_PROVIDER}}` owns branch protection and decides who may merge through the destination branch's permissions. Never merge, push, or change remote state without the applicable approval.

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
