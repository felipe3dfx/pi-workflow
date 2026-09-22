---
name: mutation-testing
description: "Trigger: measure whether durable tests resist mutations in a bounded high-value change. Report informative evidence or honest unsupported status."
license: MIT
metadata:
  author: "Grupo Ilao"
  version: "1.0"
  provenance: original
---

# Measure Test Strength with Mutation Testing

## Activation Contract

Use optionally after a stable candidate and its temporary capture exist. This skill measures the strength of durable tests over a bounded, high-value changed scope. It informs the developer; it does not create tests, remove tests, choose scope, set consumer budgets, or block implementation merely because mutation testing is unavailable.

## Preconditions

Consume the current candidate capture, selected modules, participating tests, consumer mutation runner, and configured time or resource budget. The consumer owns runner, framework, module selection policy, and budget. A code edit invalidates the capture: refresh it and rerun affected checks before reporting a result.

Per ADR 0004, return `unsupported` only when no compatible mechanism exists or no executable tests cover the selected scope. Return `requires-setup` only when a known mechanism lacks required installation, configuration, verification, or budget. Do not use these states interchangeably, simulate mutants, infer a score, or expand setup during this invocation.

## Execution

1. Verify the selected modules are changed and high-value, the tests are durable behavior tests where applicable, and the scope stays within the capture.
2. Run the consumer's compatible mutation process within its bounded budget.
3. Classify every observed mutant as killed, surviving, uncovered, or likely equivalent. For `completed`, preserve tool output at an invocation-temporary raw-result location, never as a durable artifact. For `unsupported`, `requires-setup`, or `incomplete`, explain its absence only when no usable output exists; otherwise preserve that output at the same kind of location.
4. Present surviving and uncovered mutants as evidence. The developer decides whether to strengthen, retain, or remove a test; no test changes are automatic.

A run that starts but fails or does not finish is `incomplete`, including a runner failure or expired budget. An invalidated capture also makes the measurement incomplete. Neither is a claim that tests are weak or strong. Required implementation checks remain the caller's responsibility.

## Output Contract

Return `completed`, `unsupported`, `requires-setup`, or `incomplete`; selected modules and participating tests; capture scope; command; duration; budget; killed, surviving, uncovered, and likely-equivalent mutants; omissions; and developer decisions still needed. A `completed` result requires an invocation-temporary, non-durable raw-result location. For `unsupported`, `requires-setup`, or `incomplete`, return that location when usable output exists; otherwise explain its absence. State that the result is informative and no commit, tracker effect, or durable capture was created.
