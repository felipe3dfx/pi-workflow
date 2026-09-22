# Issue Tracker: GitHub

Issues and specifications for this repository live in GitHub Issues. Use the confirmed GitHub access mechanism; do not assume a particular client.

## Availability

GitHub issue access:

- state: {{GITHUB_ISSUES_CAPABILITY_STATE}}
- evidence: {{GITHUB_ISSUES_CAPABILITY_EVIDENCE}}
- provider: {{GITHUB_ISSUES_CAPABILITY_PROVIDER}}
- limits: {{GITHUB_ISSUES_CAPABILITY_LIMITS}}
- effects/approval: {{GITHUB_ISSUES_CAPABILITY_EFFECTS}}
- degraded: {{GITHUB_ISSUES_CAPABILITY_DEGRADED}}
- blocked when: {{GITHUB_ISSUES_CAPABILITY_BLOCKED_WHEN}}

## When a Skill Says "Publish to the Issue Tracker"

Create a GitHub issue in `{{GITHUB_REPOSITORY}}` with these confirmed fields:

- Title: `{{ISSUE_TITLE_CONVENTION}}`
- Body: `{{ISSUE_DESCRIPTION_CONVENTION}}`
- Labels, assignee, milestone, project, and linked issues: `{{GITHUB_REQUIRED_FIELDS}}`

Publication capability:

- state: {{GITHUB_PUBLICATION_CAPABILITY_STATE}}
- evidence: {{GITHUB_PUBLICATION_CAPABILITY_EVIDENCE}}
- provider: {{GITHUB_PUBLICATION_CAPABILITY_PROVIDER}}
- limits: {{GITHUB_PUBLICATION_CAPABILITY_LIMITS}}
- effects/approval: {{GITHUB_PUBLICATION_CAPABILITY_EFFECTS}}
- degraded: {{GITHUB_PUBLICATION_CAPABILITY_DEGRADED}}
- blocked when: {{GITHUB_PUBLICATION_CAPABILITY_BLOCKED_WHEN}}

Do not invent labels, milestones, projects, or relationships when a marker remains unresolved. Return the issue number and URL after creation.

## When a Skill Says "Fetch the Relevant Ticket"

Retrieve the issue body, comments, state, labels, assignees, milestone, project, linked issues, and linked pull requests. Resolve whether a referenced number is an issue or pull request before acting.

Read capability:

- state: {{GITHUB_READ_CAPABILITY_STATE}}
- evidence: {{GITHUB_READ_CAPABILITY_EVIDENCE}}
- provider: {{GITHUB_READ_CAPABILITY_PROVIDER}}
- limits: {{GITHUB_READ_CAPABILITY_LIMITS}}
- effects/approval: {{GITHUB_READ_CAPABILITY_EFFECTS}}
- degraded: {{GITHUB_READ_CAPABILITY_DEGRADED}}
- blocked when: {{GITHUB_READ_CAPABILITY_BLOCKED_WHEN}}

## Comments and Updates

Write human-facing issue titles, bodies, and comments in Spanish. This is a workflow invariant, not a consumer preference, and it holds even where the repository's own conventions prescribe another language. Append progress or decisions according to `{{GITHUB_COMMENT_POLICY}}`. Changes that create, edit, label, assign, or close an issue are external effects and require the approval defined in `pull-requests.md`.
