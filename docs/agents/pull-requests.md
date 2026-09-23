# Pull Request Playbook

## Commit Structure

Create commits according to `conventional commits`. A pull request may carry as many commits as needed. Publishing a pull request never closes or transitions the tracker ticket; closing it stays a separate human decision.

Commit capability:

- state: supported
- evidence: git 2.55.0; this directory is a Git repository
- provider: git
- limits: signing uses the repository configuration and is not changed
- effects/approval: a local commit requires explicit approval
- degraded: none (confirmed absent)
- blocked when: git is unavailable or commit signing fails

## When a Skill Says "Create a Pull Request"

Use `GitHub` and create a pull request with:

- Source and proposed destination: `main`
- Body: the fixed template below; add no other section.
- Linked ticket and required evidence: the pull request cites the tracker ticket identifier, and how evidence returns to the ticket belongs to `issue-tracker.md`.
- Reviewers, labels, and drafts: open the pull request ready for review, with no labels and no reviewers. Labels and reviewers remain a manual human process.

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
- effects/approval: creating a branch requires explicit approval
- degraded: none (confirmed absent)
- blocked when: git is unavailable

### Push Capability

- state: supported
- evidence: origin tracks the current branch and repository permissions include push
- provider: git
- limits: no push was executed during discovery
- effects/approval: push requires explicit approval
- degraded: none (confirmed absent)
- blocked when: push permission is missing or the remote rejects the update

### Pull Request Capability

- state: supported
- evidence: gh pr list succeeded; pull request 60 is merged into main
- provider: gh
- limits: no pull request was created during discovery
- effects/approval: opening a pull request requires explicit approval
- degraded: none (confirmed absent)
- blocked when: gh is unauthenticated or the GitHub API fails

### Review-Thread Capability

- state: supported
- evidence: gh read of pull request 60 review comments and reviews succeeded
- provider: gh
- limits: pull request 60 has no review comments
- effects/approval: posting a review requires explicit approval
- degraded: none (confirmed absent)
- blocked when: gh is unauthenticated or the GitHub API fails

### CI Capability

- state: supported
- evidence: .github/workflows/ci.yml runs npm run check; job test passed on pull request 60
- provider: GitHub Actions
- limits: CI runs on push and pull requests to main
- effects/approval: read
- degraded: none (confirmed absent)
- blocked when: the workflow is absent or the check fails

## Approval Gates and External Effects

Approval is per effect: every external effect requires the explicit approval of the person performing it, and approval evidence is preserved with the pull request or its linked ticket. The playbook records no standing approval and no named approver; the per-invocation plan `create-pr` requires is that skill's own contract.

## Review and Merge

Review, required checks, and merge belong to the pull-request provider: `GitHub` owns branch protection and decides who may merge through the destination branch's permissions. Never merge, push, or change remote state without the applicable approval.

### Review Capability

- state: supported
- evidence: gh can read pull request reviews; main has no branch protection
- provider: GitHub
- limits: reviews are not required
- effects/approval: submitting a review requires explicit approval
- degraded: none (confirmed absent)
- blocked when: gh is unauthenticated or the GitHub API fails

### Merge Capability

- state: supported
- evidence: pull request 60 merged into main; repository permissions include admin; main has no branch protection
- provider: GitHub
- limits: no merge was executed during discovery
- effects/approval: merge requires explicit approval
- degraded: none (confirmed absent)
- blocked when: permission is missing or the GitHub API fails
