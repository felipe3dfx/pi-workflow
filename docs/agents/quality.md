# Quality Playbook

## Focused Validation

Run `npm run check` for the impact set: the touched area plus the callers and consumers it affects. Builds and fixes use this path. Record command status, duration, and relevant output; do not replace a failed command with a weaker check.

- state: supported
- evidence: AGENTS.md and package.json declare npm run check; historical CI job test passed on pull request 60
- provider: npm
- limits: discovery did not run the validation suite
- effects/approval: local validation
- blocked when: npm run check fails or Node dependencies are missing
- none (confirmed absent): degraded

## Full Validation

`create-pr` runs `npm run check` on the exact head before every push, and CI runs it after publication; no review skill runs it. If the command is absent or unverified, report its state and use only the recorded degraded behavior. When the repository defines a single validation command, that command is the candidate for both focused and full validation; the same value recorded twice is one candidate, not a question, and no scoped variant is invented.

- state: supported
- evidence: AGENTS.md names npm run check as the complete quality gate; historical CI job test passed on pull request 60
- provider: npm
- limits: discovery did not run the validation suite
- effects/approval: local validation
- blocked when: npm run check fails or Node dependencies are missing
- none (confirmed absent): degraded

## Test Conventions

Follow `node --test test/*.test.mjs`. Required fixtures, services, environments, and time budgets are `Node.js >=22.19; npm ci; temporary agent directories and Git repositories; stdio MCP fixture subprocesses; npm and tar for packed-distribution validation; live checks are opt-in and use their source-defined prerequisites and per-test deadlines; no repository-wide time budget is defined`.

## Scratch Evidence

Scratch runs isolate state shared across checkouts by `withAgentDirectory`.

- state: supported
- evidence: test/support/jev-routing.mjs creates and cleans per-test mkdtemp directories; tests also use temporary Git repositories and stdio MCP fixture subprocesses; packed-distribution validation creates and removes its own temporary workspace; live checks have separate opt-in prerequisites
- blocked when: Node dependencies are missing or a test writes outside its temporary directory
- none (confirmed absent): degraded

## Quality Tools

### Static Analysis

Tools: `biome, typescript, knip`

- state: supported
- evidence: package.json check:biome runs biome check; check:typecheck runs tsc --noEmit; check:knip runs knip; all are included in npm run check; Knip checks dependency usage, not security vulnerabilities; biome, TypeScript, and Knip version probes succeeded
- provider: biome, typescript, knip
- limits: included in npm run check
- effects/approval: read-only check
- blocked when: a declared static-analysis tool is missing or its check fails
- none (confirmed absent): degraded

### Formatting

Tools: `biome`

- state: supported
- evidence: package.json format runs biome format --write .; biome is declared in package.json devDependencies
- provider: biome
- limits: npm run check disables the formatter
- effects/approval: npm run format writes files and follows the approval policy in pull-requests.md
- blocked when: biome is missing or formatting fails
- none (confirmed absent): degraded

### Dependency or Security Checks

Tools: `none (confirmed absent)`

- Dependency or Security Checks: unsupported — evidence: no security tool is declared in package.json scripts or .github/workflows

### Mutation Testing

- Mutation Testing: unsupported — evidence: no consumer-defined tool, valuable scope, exclusions, time budget, baseline, or survivor policy

Skip the phase and say so in the report. Mutation testing remains `unsupported` until the consumer defines its tool, valuable scope, exclusions, time budget, baseline, and survivor policy. Do not infer any of those values from a first run.
