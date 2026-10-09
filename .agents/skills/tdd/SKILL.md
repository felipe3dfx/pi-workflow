---
name: tdd
description: "Trigger: develop a feature or fix test-first. Establish behavior-level public seams and work vertically from reproducible RED to GREEN."
license: MIT
metadata:
  author: "Grupo Ilao"
  version: "1.3"
  provenance: derived
---

# Test-Driven Development

## Activation Contract

Use for meaningful observable behavior while implementing an approved change. This skill owns behavior-level RED→GREEN development at pre-agreed public seams; it does not choose product scope, replace consumer test policy, simplify code, or perform broad review.

## Decision Gate

Consume the technical handoff, applicable authority, and consumer testing contract. Before a test, confirm the named seam or ask the developer to resolve a missing or contradicted seam. Prefer the highest useful existing public interface that fully exercises the behavior. Load the `codebase-design` skill only when seam shape needs design vocabulary.

Before the first test of each required behavior, agree its coverage line and trace it to the requirement it serves: the observable behavior, its seam, the pertinent cases (the success path plus each state, limit, and rejection or error the requirement or the seam's boundary names), each case's independent expected-value source, and its planned evidence or a no-valuable-test-seam exception. A requirement without a line, or a pertinent case missing from one, is a coverage gap: complete the line, within approved scope, before that behavior's first test. Plan the cases a requirement makes pertinent, not every combination of inputs; tests still follow one at a time.

A documentation-only, purely visual, or configuration-only change may record a no-valuable-test-seam exception only when it has no valuable test seam and the decision is recorded with its reason. Otherwise missing seams, an unresolved governing-authority or required-contract contradiction, or an unavailable required test path blocks this activity rather than inventing an internal test.

## Red-Green Loop

1. Establish the current safety net with the consumer's relevant checks.
2. Write one durable behavior test at the agreed seam and record a reproducible assertion RED, not a setup failure. Derive expected values from an approved specification, worked example, or known literal independent of the implementation.
3. Add only the implementation needed for GREEN and record the result.
4. Add another example only when it materially strengthens the contract; then repeat for the next planned case and the next behavior.

Work in vertical slices, not a batch of imagined tests followed by implementation. Test the public result, side effect, or state rather than private methods, internal collaborators, call order, or plumbing. Do not hide assertions in stubs or calculate the expected value by the same rule under test. A function-level test is appropriate only where that function owns a durable rule not covered at a more useful seam.

Read [valuable tests](references/valuable-tests.md) before writing the first test of a behavior: it is the rubric each test must meet, and the one review grades the tests against.

Use the consumer's runner, framework, test layout, fixtures, and nearest useful end-to-end seam. Run focused tests during the loop and record actual commands and results; failures after GREEN return the candidate to implementation until it is functioning. TDD records evidence for the caller and does not commit or publish.

## Output Contract

Return each behavior's coverage line with every case marked tested, skipped with its reason, or excepted (a skipped case is never GREEN), plus each confirmed seam, independent expected-value source, RED command/result, GREEN command/result, triangulation decision, applicable safety-net evidence, no-seam exception, and blockers. State that these are implementation handoff evidence, not a replacement for the consumer's broader quality checks or independent review.
