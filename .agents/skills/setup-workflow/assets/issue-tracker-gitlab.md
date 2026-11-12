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

Create a GitLab issue in `{{GITLAB_PROJECT}}` with these fields:

- Title and description: defined by the publishing skill, `to-spec` for the specification and `to-tickets` for each ticket; the project's description templates do not apply
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

Retrieve the issue description, notes, state, labels, assignees, milestone, iteration, epic, linked issues, and linked merge requests. Where the project offers native blocking links, retrieve the issues blocking this one with each blocker's current state: an epic or a `relates to` link alone is not a blocker, and only an open blocker blocks the issue. Use GitLab's issue IID within the confirmed project.

Read capability:

- state: {{GITLAB_READ_CAPABILITY_STATE}}
- evidence: {{GITLAB_READ_CAPABILITY_EVIDENCE}}
- provider: {{GITLAB_READ_CAPABILITY_PROVIDER}}
- limits: {{GITLAB_READ_CAPABILITY_LIMITS}}
- effects/approval: {{GITLAB_READ_CAPABILITY_EFFECTS}}
- degraded: {{GITLAB_READ_CAPABILITY_DEGRADED}}
- blocked when: {{GITLAB_READ_CAPABILITY_BLOCKED_WHEN}}

## Comments and Updates

Write human-facing issue titles, descriptions, and notes in Spanish. This is a workflow invariant, not a consumer preference, and it holds even where the repository's own conventions prescribe another language. Append progress or decisions according to `{{GITLAB_COMMENT_POLICY}}`; that policy may only reduce or schedule the publishable events and never adds another kind. A progress or decision comment carries only a scope change (including a Work Contract addition), a deviation, an accepted risk, or the pull request link; a technical decision stays in the commit body. Changes that create, edit, label, assign, or close an issue are external effects and require the approval defined in `pull-requests.md`. Before any such change, confirm that the project the access mechanism will act on, as the mechanism reports it or as the call names it explicitly, is the one recorded above; a fork, a remote, or a mechanism default never stands in for it, and a mismatch or a destination that cannot be confirmed blocks the change.

These comments and closure explanations share one shape that no comment policy overrides: written for a person without the code, in Spanish and domain language, in at most five lines, stating the fact, then why, then what changes for the reader, with nothing the reader would have to look up in the code. A deviation or scope change names the affected acceptance criterion in the ticket's own wording; a Work Contract addition states the new behavior as one verifiable criterion in that wording. The QA comment follows its own format, outside this shape.

When a skill closes an issue with an explanation, post the explanation as a note and read it back on the issue, then close the issue and read back its closed state; each is an effect under the approval policy. When recovering an interrupted closure, an explanation the issue already shows is not posted again.
