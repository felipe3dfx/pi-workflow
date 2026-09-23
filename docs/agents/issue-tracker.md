# Issue Tracker: GitHub

Issues and specifications for this repository live in GitHub Issues. Use the confirmed GitHub access mechanism; do not assume a particular client.

## Availability

GitHub issue access:

- state: supported
- evidence: gh issue list and gh label list succeeded
- provider: gh
- limits: repository issues are enabled; none exist
- effects/approval: read
- degraded: none (confirmed absent)
- blocked when: gh is missing, unauthenticated, or the GitHub API fails

## When a Skill Says "Publish to the Issue Tracker"

Create a GitHub issue in `felipe3dfx/pi-workflow` with these confirmed fields:

- Title: `none (confirmed absent)`
- Body: `none (confirmed absent)`
- Labels, assignee, milestone, project, and linked issues: `labels, assignee, milestone, and project remain none (confirmed absent); linked issues use gh issue edit --add-blocked-by; parent and child use gh issue edit --parent`

Publication capability:

- state: supported
- evidence: repository permissions include admin, push, and triage; has_issues is true
- provider: gh
- limits: no issue was created in this repository during discovery
- effects/approval: create, edit, label, assign, close, or relate requires explicit approval
- degraded: none (confirmed absent)
- blocked when: permission is missing or the GitHub API fails

Do not invent labels, milestones, projects, or relationships when a marker remains unresolved. Return the issue number and URL after creation.

## When a Skill Says "Fetch the Relevant Ticket"

Retrieve the issue body, comments, state, labels, assignees, milestone, project, linked issues, and linked pull requests. Resolve whether a referenced number is an issue or pull request before acting.

Read capability:

- state: supported
- evidence: gh issue list succeeded for felipe3dfx/pi-workflow
- provider: gh
- limits: repository issues are enabled; none exist
- effects/approval: read
- degraded: none (confirmed absent)
- blocked when: gh is missing, unauthenticated, or the GitHub API fails

## Comments and Updates

Write human-facing issue titles, bodies, and comments in Spanish. This is a workflow invariant, not a consumer preference, and it holds even where the repository's own conventions prescribe another language. Append progress or decisions according to `none (confirmed absent)`. Changes that create, edit, label, assign, or close an issue are external effects and require the approval defined in `pull-requests.md`.
