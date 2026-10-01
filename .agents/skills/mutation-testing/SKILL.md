---
name: mutation-testing
description: "Trigger: measure whether durable tests resist mutations in a bounded high-value change. Report informative evidence or honest unsupported status."
license: MIT
metadata:
  author: "Grupo Ilao"
  version: "1.1"
  provenance: original
---

# Measure Test Strength with Mutation Testing

## Activation Contract

Use on demand, outside the implementation loop, over a committed range named by its base and head commit SHAs. This skill measures the strength of durable tests over a bounded, high-value changed scope. It informs the developer; it does not create tests, remove tests, choose scope, set consumer budgets, or block any workflow because mutation testing is unavailable.

## Preconditions

Consume the committed range, selected modules, participating tests, consumer mutation runner, and configured time or resource budget. The consumer owns runner, framework, module selection policy, and budget. A working tree that differs from the head commit invalidates the measurement.

Return `unsupported` only when no compatible mechanism exists or no executable tests cover the selected scope. Return `requires-setup` only when a known mechanism lacks required installation, configuration, verification, or budget. Do not use these states interchangeably, simulate mutants, infer a score, or expand setup during this invocation.

## Execution

1. Verify the selected modules are changed and high-value, the tests are durable behavior tests where applicable, and the scope stays within the committed range.
2. Run the consumer's compatible mutation process within its bounded budget.
3. Classify every observed mutant as killed, surviving, uncovered, or likely equivalent.
4. Present surviving and uncovered mutants as evidence. The developer decides whether to strengthen, retain, or remove a test; no test changes are automatic.

A run that starts but fails or does not finish is `incomplete`, including a runner failure or expired budget. An invalidated measurement is also incomplete. Neither is a claim that tests are weak or strong.

## Output Contract

Return `completed`, `unsupported`, `requires-setup`, or `incomplete`; selected modules and participating tests; base and head commit SHAs; command; duration; budget; killed, surviving, uncovered, and likely-equivalent mutants; omissions; and developer decisions still needed. A `completed` result requires an invocation-temporary, non-durable raw-result location. For `unsupported`, `requires-setup`, or `incomplete`, return that location when usable output exists; otherwise explain its absence. State that the result is informative and no commit or tracker effect was created.
