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

Create a GitHub issue in `{{GITHUB_REPOSITORY}}` with these fields:

- Title and body: defined by the publishing skill, `to-spec` for the specification and `to-tickets` for each ticket; the repository's issue templates and issue forms do not apply
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

When both the parent issue and the child issue exist, publish the parent-child (sub-issue) relationship and read it back before reporting it published.

## When a Skill Says "Fetch the Relevant Ticket"

Retrieve the issue body, comments, state, labels, assignees, milestone, project, linked issues, linked pull requests, and the issue's parent and sub-issues. Retrieve its native blocked-by relationships with each blocker's current state: the parent relationship alone is not a blocker, and only an open blocker blocks the issue. Resolve whether a referenced number is an issue or pull request before acting.

Read capability:

- state: {{GITHUB_READ_CAPABILITY_STATE}}
- evidence: {{GITHUB_READ_CAPABILITY_EVIDENCE}}
- provider: {{GITHUB_READ_CAPABILITY_PROVIDER}}
- limits: {{GITHUB_READ_CAPABILITY_LIMITS}}
- effects/approval: {{GITHUB_READ_CAPABILITY_EFFECTS}}
- degraded: {{GITHUB_READ_CAPABILITY_DEGRADED}}
- blocked when: {{GITHUB_READ_CAPABILITY_BLOCKED_WHEN}}

## Comments and Updates

Write human-facing issue titles, bodies, and comments in Spanish. This is a workflow invariant, not a consumer preference, and it holds even where the repository's own conventions prescribe another language. Append progress or decisions according to `{{GITHUB_COMMENT_POLICY}}`; that policy may only reduce or schedule the publishable events and never adds another kind. A progress or decision comment carries only a scope change (including a Work Contract addition), a deviation, an accepted risk, or the pull request link; a technical decision stays in the commit body. Changes that create, edit, label, assign, or close an issue are external effects and require the approval defined in `pull-requests.md`. Before any such change, confirm that the repository the access mechanism will act on, as the mechanism reports it or as the call names it explicitly, is the one recorded above; a fork, a remote, or a mechanism default never stands in for it, and a mismatch or a destination that cannot be confirmed blocks the change.

These comments and closure explanations share one shape that no comment policy overrides: written for a person without the code, in Spanish and domain language, in at most five lines, stating the fact, then why, then what changes for the reader, with nothing the reader would have to look up in the code. A deviation or scope change names the affected acceptance criterion in the ticket's own wording; a Work Contract addition states the new behavior as one verifiable criterion in that wording. The QA comment follows its own format, outside this shape.

When a skill closes an issue with an explanation, post the explanation as a comment and read it back on the issue, then close the issue and read back its closed state; each is an effect under the approval policy. When recovering an interrupted closure, an explanation the issue already shows is not posted again.
