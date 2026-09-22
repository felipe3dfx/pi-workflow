# Issue Tracker: GitLab

Issues and specifications for this repository live in GitLab Issues. Use the confirmed GitLab access mechanism; do not assume a particular client.

## Availability

GitLab issue access:

- state: {{GITLAB_ISSUES_CAPABILITY_STATE}}
- evidence: {{GITLAB_ISSUES_CAPABILITY_EVIDENCE}}
- provider: {{GITLAB_ISSUES_CAPABILITY_PROVIDER}}
- limits: {{GITLAB_ISSUES_CAPABILITY_LIMITS}}
- effects/approval: {{GITLAB_ISSUES_CAPABILITY_EFFECTS}}
- degraded: {{GITLAB_ISSUES_CAPABILITY_DEGRADED}}
- blocked when: {{GITLAB_ISSUES_CAPABILITY_BLOCKED_WHEN}}

## When a Skill Says "Publish to the Issue Tracker"

Create a GitLab issue in `{{GITLAB_PROJECT}}` with these confirmed fields:

- Title: `{{ISSUE_TITLE_CONVENTION}}`
- Description: `{{ISSUE_DESCRIPTION_CONVENTION}}`
- Labels, assignee, milestone, iteration, epic, and linked issues: `{{GITLAB_REQUIRED_FIELDS}}`

Publication capability:

- state: {{GITLAB_PUBLICATION_CAPABILITY_STATE}}
- evidence: {{GITLAB_PUBLICATION_CAPABILITY_EVIDENCE}}
- provider: {{GITLAB_PUBLICATION_CAPABILITY_PROVIDER}}
- limits: {{GITLAB_PUBLICATION_CAPABILITY_LIMITS}}
- effects/approval: {{GITLAB_PUBLICATION_CAPABILITY_EFFECTS}}
- degraded: {{GITLAB_PUBLICATION_CAPABILITY_DEGRADED}}
- blocked when: {{GITLAB_PUBLICATION_CAPABILITY_BLOCKED_WHEN}}

Do not invent labels, milestones, iterations, epics, or relationships when a marker remains unresolved. Return the issue IID and URL after creation.

## When a Skill Says "Fetch the Relevant Ticket"

Retrieve the issue description, notes, state, labels, assignees, milestone, iteration, epic, linked issues, and linked merge requests. Use GitLab's issue IID within the confirmed project.

Read capability:

- state: {{GITLAB_READ_CAPABILITY_STATE}}
- evidence: {{GITLAB_READ_CAPABILITY_EVIDENCE}}
- provider: {{GITLAB_READ_CAPABILITY_PROVIDER}}
- limits: {{GITLAB_READ_CAPABILITY_LIMITS}}
- effects/approval: {{GITLAB_READ_CAPABILITY_EFFECTS}}
- degraded: {{GITLAB_READ_CAPABILITY_DEGRADED}}
- blocked when: {{GITLAB_READ_CAPABILITY_BLOCKED_WHEN}}

## Comments and Updates

Write human-facing issue titles, descriptions, and notes in Spanish. This is a workflow invariant, not a consumer preference, and it holds even where the repository's own conventions prescribe another language. Append progress or decisions according to `{{GITLAB_COMMENT_POLICY}}`. Changes that create, edit, label, assign, or close an issue are external effects and require the approval defined in `pull-requests.md`.
