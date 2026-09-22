# Quality Playbook

## Focused Validation

Run `npm run check` for the affected area. Record command status, duration, and relevant output; do not replace a failed command with a weaker check.

- state: supported
- evidence: AGENTS.md and package.json declare npm run check; CI job test passed on pull request 60
- provider: npm
- limits: discovery did not run the validation suite
- effects/approval: local validation
- degraded: none (confirmed absent)
- blocked when: npm run check fails or Node dependencies are missing

## Full Validation

Before the confirmed handoff point, run `npm run check`. If the command is absent or unverified, report its state and use only the recorded degraded behavior. When the repository defines a single validation command, that command is the candidate for both focused and full validation; the same value recorded twice is one candidate, not a question, and no scoped variant is invented.

- state: supported
- evidence: AGENTS.md names npm run check as the complete quality gate; CI job test passed on pull request 60
- provider: npm
- limits: discovery did not run the validation suite
- effects/approval: local validation
- degraded: none (confirmed absent)
- blocked when: npm run check fails or Node dependencies are missing

## Test Conventions

Follow `node --test test/*.test.mjs`. Required fixtures, services, environments, and time budgets are `none (confirmed absent)`.

## Quality Tools

### Static Analysis

Tools: `biome`

- state: supported
- evidence: package.json check:biome runs biome check; biome 2.5.3 is installed
- provider: biome
- limits: included in npm run check
- effects/approval: read-only check
- degraded: none (confirmed absent)
- blocked when: biome is missing or the check fails

### Formatting

Tools: `biome`

- state: supported
- evidence: package.json format runs biome format --write .; biome 2.5.3 is installed
- provider: biome
- limits: npm run check disables the formatter
- effects/approval: npm run format writes files and requires explicit approval
- degraded: none (confirmed absent)
- blocked when: biome is missing or formatting fails

### Dependency or Security Checks

Tools: `none (confirmed absent)`

- state: unsupported
- evidence: no security tool is declared in package.json scripts or .github/workflows
- provider: none (confirmed absent)
- limits: none (confirmed absent)
- effects/approval: none (confirmed absent)
- degraded: none (confirmed absent)
- blocked when: none (confirmed absent)

### Mutation Testing

- state: unsupported. Skip the phase and say so in the report.

Mutation testing remains `unsupported` until the consumer defines its tool, valuable scope, exclusions, time budget, baseline, and survivor policy. Do not infer any of those values from a first run.
