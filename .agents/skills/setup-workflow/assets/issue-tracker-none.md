# Issue Tracker: None Recorded

This repository has no issue tracker. The absence was confirmed by the user during setup, not inferred from a failed search.

## Availability

Issue tracking: `unsupported`. No mechanism is available, so every phase that publishes, reads, or comments on a ticket is omitted with an explicit record rather than degraded silently.

This state changes only through `setup-workflow`, after a tracker exists and the user confirms it. A skill that finds tracker evidence in the repository has found a contradiction: report it and propose `setup-workflow`; never adopt a tracker this playbook does not record.

## When a Skill Says "Publish to the Issue Tracker"

Stop and report that publication is `unsupported`. Return the content that would have been published so the user can place it by hand. Never write it to a file, a branch, or a commit message as a substitute.

## When a Skill Says "Fetch the Relevant Ticket"

Stop and report that no tracker exists. Ask the user to supply the ticket content directly. A skill that requires ticket authority to proceed is `blocked` for that invocation.

## Human Language

Not applicable while this state holds. When a tracker is recorded later, human-facing titles, descriptions, and comments are written in Spanish. This is a workflow invariant, not a consumer preference, and it holds even where the repository's own conventions prescribe another language.

## External Effects

None. This playbook records an absence and authorizes no action.
