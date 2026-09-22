# Workflow Playbook

## Authority and Precedence

Follow this order when instructions conflict:

1. `{{PRIMARY_REPOSITORY_INSTRUCTIONS}}`
2. `docs/agents/domain.md` and the authority it resolves, plus applicable architectural decisions
3. This `docs/agents/` playbook set
4. `{{LOCAL_WORKFLOW_CONVENTIONS}}`

An unresolved marker is absent authority, not permission to choose a default. A value recorded `none (confirmed absent)` is settled: a later skill proposes `setup-workflow` only for an unresolved marker or a verifiable contradiction, never for a confirmed absence.

## Branch Proposals

- Working base: `{{WORKING_BASE}}`
- Production base: `{{PRODUCTION_BASE}}`
- Parent integration branch: `{{PARENT_INTEGRATION_BRANCH}}`
- Child branch naming: `{{CHILD_BRANCH_CONVENTION}}`

These are proposals for later skills. Confirm the merge destination for each change; a different destination never blocks execution.

## Review Policy

- Prefer breadth over depth when choosing independent work: `{{REVIEW_BREADTH_POLICY}}`
- Maximum dependency-chain depth: `{{MAXIMUM_DEPENDENCY_DEPTH}}`
- Maximum open unreviewed pull requests per implementer: `{{OPEN_PULL_REQUEST_LIMIT}}`

## Ownership

Shared skills define reusable process. This repository owns local policy, implementation knowledge, validation commands, tracker configuration, branch values, and approval rules. `setup-workflow` owns this `docs/agents/` directory; confirm treatment of unrelated files with the user.
