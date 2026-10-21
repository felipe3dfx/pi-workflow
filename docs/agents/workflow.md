# Workflow Playbook

## Authority and Precedence

Follow the instruction authority and precedence defined by `AGENTS.md`.

Apply this `docs/agents/` playbook set, `docs/agents/domain.md` and the authority it resolves, applicable architectural decisions, and local workflow conventions in `AGENTS.md` at the authority assigned by the primary repository instructions.

An unresolved marker is absent authority, not permission to choose a default. A value recorded `none (confirmed absent)` is settled: a later skill proposes `setup-workflow` only for an unresolved marker or a verifiable contradiction, never for a confirmed absence.

## Branch Proposals

- Working base: `main`
- Production base: `main`
- Parent integration branch: `main`
- Child branch naming: `GitHub issue id`

These are proposals for later skills. Confirm the merge destination for each change; a different destination never blocks execution.

## Review Policy

- Prefer breadth over depth when choosing independent work: `none (confirmed absent)`
- Maximum dependency-chain depth: `none (confirmed absent)`
- Maximum open unreviewed pull requests per implementer: `none (confirmed absent)`
- Child integration: `direct`

## Approval Policy

- Approval policy: `autonomous`

`pull-requests.md` defines what each level asks for, what every level asks for, and the approval preview.

## Ownership

Shared skills define reusable process. This repository owns local policy, implementation knowledge, validation commands, tracker configuration, branch values, and approval rules. `setup-workflow` owns this `docs/agents/` directory; confirm treatment of unrelated files with the user.
