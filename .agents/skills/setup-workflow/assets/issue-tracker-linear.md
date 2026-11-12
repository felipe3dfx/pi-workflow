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

Create a Linear issue with these fields:

- Team: `{{LINEAR_TEAM}}`
- Title and description: defined by the publishing skill, `to-spec` for the specification and `to-tickets` for each ticket; the team's issue templates do not apply
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

For the tickets of a specification, the specification's parent wins over a `parent` required by the fields above; the parent issue itself still follows those fields.

## When a Skill Says "Fetch the Relevant Ticket"

Retrieve the issue description, comments, state, priority, labels, project, parent and child relationships, assignee, and linked artifacts. Retrieve its blocked-by relations with each blocker's current state: the parent relationship alone is not a blocker, and only a blocker not yet completed or canceled blocks the issue. Treat the fetched issue as the source of truth for the requested work.

Read capability:

- state: {{LINEAR_READ_CAPABILITY_STATE}}
- evidence: {{LINEAR_READ_CAPABILITY_EVIDENCE}}
- provider: {{LINEAR_READ_CAPABILITY_PROVIDER}}
- limits: {{LINEAR_READ_CAPABILITY_LIMITS}}
- effects/approval: {{LINEAR_READ_CAPABILITY_EFFECTS}}
- degraded: {{LINEAR_READ_CAPABILITY_DEGRADED}}
- blocked when: {{LINEAR_READ_CAPABILITY_BLOCKED_WHEN}}

## Comments and Updates

Write human-facing issue titles, descriptions, and comments in Spanish. This is a workflow invariant, not a consumer preference, and it holds even where the repository's own conventions prescribe another language. Append progress or decisions according to `{{LINEAR_COMMENT_POLICY}}`; that policy may only reduce or schedule the publishable events and never adds another kind. A progress or decision comment carries only a scope change (including a Work Contract addition), a deviation, an accepted risk, or the pull request link; a technical decision stays in the commit body. When a pull request exists for an issue, an append-only Spanish comment on that issue carries the pull request URL plus one or two lines on what the reader will see change, leaving the evidence in the pull request; it never changes the issue state, and no comment policy overrides it. Changes that create, update, assign, or close an issue are external effects and require the approval defined in `pull-requests.md`. Before any such change, confirm that the team the access mechanism will act on, as the mechanism reports it or as the call names it explicitly, is the one recorded above; a mechanism default never stands in for it, and a mismatch or a destination that cannot be confirmed blocks the change.

These comments and closure explanations share one shape that no comment policy overrides: written for a person without the code, in Spanish and domain language, in at most five lines, stating the fact, then why, then what changes for the reader, with nothing the reader would have to look up in the code. A deviation or scope change names the affected acceptance criterion in the ticket's own wording; a Work Contract addition states the new behavior as one verifiable criterion in that wording. The QA comment follows its own format, outside this shape.

When a skill closes an issue with an explanation, post the explanation as a comment and read it back on the issue, then close the issue and read back its closed state; each is an effect under the approval policy. When recovering an interrupted closure, an explanation the issue already shows is not posted again.

The team that uses this workflow keeps every closing automation off: parent auto-close, sub-issue auto-close, and auto-close of inactive issues.
