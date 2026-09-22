# Quality Playbook

## Focused Validation

Run `{{FOCUSED_VALIDATION_COMMANDS}}` for the affected area. Record command status, duration, and relevant output; do not replace a failed command with a weaker check.

- state: {{FOCUSED_VALIDATION_CAPABILITY_STATE}}
- evidence: {{FOCUSED_VALIDATION_CAPABILITY_EVIDENCE}}
- provider: {{FOCUSED_VALIDATION_CAPABILITY_PROVIDER}}
- limits: {{FOCUSED_VALIDATION_CAPABILITY_LIMITS}}
- effects/approval: {{FOCUSED_VALIDATION_CAPABILITY_EFFECTS}}
- degraded: {{FOCUSED_VALIDATION_CAPABILITY_DEGRADED}}
- blocked when: {{FOCUSED_VALIDATION_CAPABILITY_BLOCKED_WHEN}}

## Full Validation

Before the confirmed handoff point, run `{{FULL_VALIDATION_COMMANDS}}`. If the command is absent or unverified, report its state and use only the recorded degraded behavior. When the repository defines a single validation command, that command is the candidate for both focused and full validation; the same value recorded twice is one candidate, not a question, and no scoped variant is invented.

- state: {{FULL_VALIDATION_CAPABILITY_STATE}}
- evidence: {{FULL_VALIDATION_CAPABILITY_EVIDENCE}}
- provider: {{FULL_VALIDATION_CAPABILITY_PROVIDER}}
- limits: {{FULL_VALIDATION_CAPABILITY_LIMITS}}
- effects/approval: {{FULL_VALIDATION_CAPABILITY_EFFECTS}}
- degraded: {{FULL_VALIDATION_CAPABILITY_DEGRADED}}
- blocked when: {{FULL_VALIDATION_CAPABILITY_BLOCKED_WHEN}}

## Test Conventions

Follow `{{TEST_CONVENTIONS}}`. Required fixtures, services, environments, and time budgets are `{{TEST_EXECUTION_CONSTRAINTS}}`.

## Quality Tools

### Static Analysis

Tools: `{{STATIC_ANALYSIS_TOOLS}}`

- state: {{STATIC_ANALYSIS_CAPABILITY_STATE}}
- evidence: {{STATIC_ANALYSIS_CAPABILITY_EVIDENCE}}
- provider: {{STATIC_ANALYSIS_CAPABILITY_PROVIDER}}
- limits: {{STATIC_ANALYSIS_CAPABILITY_LIMITS}}
- effects/approval: {{STATIC_ANALYSIS_CAPABILITY_EFFECTS}}
- degraded: {{STATIC_ANALYSIS_CAPABILITY_DEGRADED}}
- blocked when: {{STATIC_ANALYSIS_CAPABILITY_BLOCKED_WHEN}}

### Formatting

Tools: `{{FORMATTING_TOOLS}}`

- state: {{FORMATTING_CAPABILITY_STATE}}
- evidence: {{FORMATTING_CAPABILITY_EVIDENCE}}
- provider: {{FORMATTING_CAPABILITY_PROVIDER}}
- limits: {{FORMATTING_CAPABILITY_LIMITS}}
- effects/approval: {{FORMATTING_CAPABILITY_EFFECTS}}
- degraded: {{FORMATTING_CAPABILITY_DEGRADED}}
- blocked when: {{FORMATTING_CAPABILITY_BLOCKED_WHEN}}

### Dependency or Security Checks

Tools: `{{SECURITY_TOOLS}}`

- state: {{SECURITY_CAPABILITY_STATE}}
- evidence: {{SECURITY_CAPABILITY_EVIDENCE}}
- provider: {{SECURITY_CAPABILITY_PROVIDER}}
- limits: {{SECURITY_CAPABILITY_LIMITS}}
- effects/approval: {{SECURITY_CAPABILITY_EFFECTS}}
- degraded: {{SECURITY_CAPABILITY_DEGRADED}}
- blocked when: {{SECURITY_CAPABILITY_BLOCKED_WHEN}}

### Mutation Testing

- state: unsupported. Skip the phase and say so in the report.

Mutation testing remains `unsupported` until the consumer defines its tool, valuable scope, exclusions, time budget, baseline, and survivor policy. Do not infer any of those values from a first run.
