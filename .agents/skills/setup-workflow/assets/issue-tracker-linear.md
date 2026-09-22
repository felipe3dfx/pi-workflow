# Issue Tracker: Linear

Issues and specifications for this repository live in Linear. Use the confirmed Linear access mechanism; do not assume a particular client.

## Availability

Linear access:

- state: {{LINEAR_ACCESS_CAPABILITY_STATE}}
- evidence: {{LINEAR_ACCESS_CAPABILITY_EVIDENCE}}
- provider: {{LINEAR_ACCESS_CAPABILITY_PROVIDER}}
- limits: {{LINEAR_ACCESS_CAPABILITY_LIMITS}}
- effects/approval: {{LINEAR_ACCESS_CAPABILITY_EFFECTS}}
- degraded: {{LINEAR_ACCESS_CAPABILITY_DEGRADED}}
- blocked when: {{LINEAR_ACCESS_CAPABILITY_BLOCKED_WHEN}}

## When a Skill Says "Publish to the Issue Tracker"

Create a Linear issue with these confirmed fields:

- Team: `{{LINEAR_TEAM}}`
- Title: `{{ISSUE_TITLE_CONVENTION}}`
- Description: `{{ISSUE_DESCRIPTION_CONVENTION}}`
- State, priority, labels, project, and parent: `{{LINEAR_REQUIRED_FIELDS}}`

Publication capability:

- state: {{LINEAR_PUBLICATION_CAPABILITY_STATE}}
- evidence: {{LINEAR_PUBLICATION_CAPABILITY_EVIDENCE}}
- provider: {{LINEAR_PUBLICATION_CAPABILITY_PROVIDER}}
- limits: {{LINEAR_PUBLICATION_CAPABILITY_LIMITS}}
- effects/approval: {{LINEAR_PUBLICATION_CAPABILITY_EFFECTS}}
- degraded: {{LINEAR_PUBLICATION_CAPABILITY_DEGRADED}}
- blocked when: {{LINEAR_PUBLICATION_CAPABILITY_BLOCKED_WHEN}}

Do not invent a team, project, label, or state when a marker remains unresolved. Return the issue identifier and URL after creation.

## When a Skill Says "Fetch the Relevant Ticket"

Retrieve the issue description, comments, state, priority, labels, project, parent and child relationships, assignee, and linked artifacts. Treat the fetched issue as the source of truth for the requested work.

Read capability:

- state: {{LINEAR_READ_CAPABILITY_STATE}}
- evidence: {{LINEAR_READ_CAPABILITY_EVIDENCE}}
- provider: {{LINEAR_READ_CAPABILITY_PROVIDER}}
- limits: {{LINEAR_READ_CAPABILITY_LIMITS}}
- effects/approval: {{LINEAR_READ_CAPABILITY_EFFECTS}}
- degraded: {{LINEAR_READ_CAPABILITY_DEGRADED}}
- blocked when: {{LINEAR_READ_CAPABILITY_BLOCKED_WHEN}}

## Comments and Updates

Write human-facing issue titles, descriptions, and comments in Spanish. This is a workflow invariant, not a consumer preference, and it holds even where the repository's own conventions prescribe another language. Append progress or decisions according to `{{LINEAR_COMMENT_POLICY}}`. When a pull request exists for an issue, an append-only Spanish comment on that issue carries the pull request URL and evidence; it never changes the issue state, and no comment policy overrides it. Changes that create, update, assign, or close an issue are external effects and require the approval defined in `pull-requests.md`.
