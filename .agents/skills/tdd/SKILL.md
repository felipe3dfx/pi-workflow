---
name: tdd
description: "Trigger: develop a feature or fix test-first. Establish behavior-level public seams and work vertically from reproducible RED to GREEN."
license: MIT
metadata:
  author: "Grupo Ilao"
  version: "1.0"
  provenance: derived
---

# Test-Driven Development

## Activation Contract

Use for meaningful observable behavior while implementing an approved change. This skill owns behavior-level RED→GREEN development at pre-agreed public seams; it does not choose product scope, replace consumer test policy, simplify code, or perform broad review.

## Decision Gate

Consume the technical handoff, applicable authority, and consumer testing contract. Before a test, confirm the named seam or ask the developer to resolve a missing or contradicted seam. Prefer the highest useful existing public interface that fully exercises the behavior. Use `codebase-design` only when seam shape needs design vocabulary.

A documentation-only, purely visual, or configuration-only change may record a no-valuable-test-seam exception only when it has no valuable test seam and the decision is recorded. Otherwise missing seams, an unresolved governing-authority or required-contract contradiction, or an unavailable required test path blocks this activity rather than inventing an internal test.

## Red-Green Loop

1. Establish the current safety net with the consumer's relevant checks.
2. Write one durable behavior test at the agreed seam and record a reproducible assertion RED, not a setup failure. Derive expected values from an approved specification, worked example, or known literal independent of the implementation.
3. Add only the implementation needed for GREEN and record the result.
4. Add another example only when it materially strengthens the contract; then repeat for the next behavior.

Work in vertical slices, not a batch of imagined tests followed by implementation. Test the public result, side effect, or state rather than private methods, internal collaborators, call order, or plumbing. Do not hide assertions in stubs or calculate the expected value by the same rule under test. A function-level test is appropriate only where that function owns a durable rule not covered at a more useful seam.

Use the consumer's runner, framework, test layout, fixtures, and nearest useful end-to-end seam. Run focused tests during the loop and record actual commands and results; failures after GREEN return the candidate to implementation until it is functioning. TDD records evidence for the caller's temporary candidate capture and does not publish or commit it.

## Output Contract

Return each behavior, confirmed seam, independent expected-value source, RED command/result, GREEN command/result, triangulation decision, applicable safety-net evidence, no-seam exception, and blockers. State that these are implementation handoff evidence, not a replacement for the consumer's broader quality checks or independent review.
