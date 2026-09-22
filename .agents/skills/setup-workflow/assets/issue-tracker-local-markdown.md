# Issue Tracker: Local Markdown

Issues and specifications for this repository live as Markdown files. Use the confirmed repository paths and naming rules.

## Availability

Local issue storage:

- state: {{LOCAL_ISSUES_CAPABILITY_STATE}}
- evidence: {{LOCAL_ISSUES_CAPABILITY_EVIDENCE}}
- provider: {{LOCAL_ISSUES_CAPABILITY_PROVIDER}}
- limits: {{LOCAL_ISSUES_CAPABILITY_LIMITS}}
- effects/approval: {{LOCAL_ISSUES_CAPABILITY_EFFECTS}}
- degraded: {{LOCAL_ISSUES_CAPABILITY_DEGRADED}}
- blocked when: {{LOCAL_ISSUES_CAPABILITY_BLOCKED_WHEN}}

If the confirmed directory is absent, report the contradiction and propose `setup-workflow`; do not create a replacement path without approval.

## When a Skill Says "Publish to the Issue Tracker"

Create a file at `{{LOCAL_ISSUE_PATH_PATTERN}}` with:

- Title: `{{ISSUE_TITLE_CONVENTION}}`
- Specification and acceptance criteria: `{{ISSUE_DESCRIPTION_CONVENTION}}`
- Status, owner, priority, labels, and relationships: `{{LOCAL_REQUIRED_FIELDS}}`

Publication capability:

- state: {{LOCAL_PUBLICATION_CAPABILITY_STATE}}
- evidence: {{LOCAL_PUBLICATION_CAPABILITY_EVIDENCE}}
- provider: {{LOCAL_PUBLICATION_CAPABILITY_PROVIDER}}
- limits: {{LOCAL_PUBLICATION_CAPABILITY_LIMITS}}
- effects/approval: {{LOCAL_PUBLICATION_CAPABILITY_EFFECTS}}
- degraded: {{LOCAL_PUBLICATION_CAPABILITY_DEGRADED}}
- blocked when: {{LOCAL_PUBLICATION_CAPABILITY_BLOCKED_WHEN}}

Do not invent a directory, filename pattern, status, or metadata when a marker remains unresolved. Return the repository-relative path after creation.

## When a Skill Says "Fetch the Relevant Ticket"

Read the referenced file and its confirmed related files. Treat its content and recorded status as the source of truth for the requested work.

Read capability:

- state: {{LOCAL_READ_CAPABILITY_STATE}}
- evidence: {{LOCAL_READ_CAPABILITY_EVIDENCE}}
- provider: {{LOCAL_READ_CAPABILITY_PROVIDER}}
- limits: {{LOCAL_READ_CAPABILITY_LIMITS}}
- effects/approval: {{LOCAL_READ_CAPABILITY_EFFECTS}}
- degraded: {{LOCAL_READ_CAPABILITY_DEGRADED}}
- blocked when: {{LOCAL_READ_CAPABILITY_BLOCKED_WHEN}}

## Comments and Updates

Write human-facing issue content in Spanish. This is a workflow invariant, not a consumer preference, and it holds even where the repository's own conventions prescribe another language. Append progress or decisions according to `{{LOCAL_COMMENT_POLICY}}`. Creating, editing, moving, or deleting issue files is a repository mutation and requires the approval defined in `pull-requests.md`.
