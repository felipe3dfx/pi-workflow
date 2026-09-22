---
name: prototype
description: "Trigger: resolve a feature's functional uncertainty with a prototype. Return evidence, a proposed contract, and an explicit brief delta to feature."
license: MIT
metadata:
  author: "Grupo Ilao"
  version: "1.0"
  provenance: derived
---

# Feature Prototype

## Activation Contract

Use this optional supporting skill when a feature needs evidence about a functional question, including visual or interaction behavior. `feature` may recommend it; a direct invocation identifies the feature, question, scope, and success criterion. Return evidence to `feature`; do not silently edit the brief or replace discovery.

## Preconditions and Authority

Before creating an artifact, require a clean working tree. Report existing changes and wait. Inspect the consumer's recorded contracts, resolved Domain Authority Handoff, accepted ADRs, and relevant conventions. When the consumer is a mature repository, inspect analogous routes, components, templates, design-system, token, interaction, and test conventions, then reuse the applicable conventions in the artifact. If required authority is absent, ambiguous, or contradictory, block and route layout defects to `setup-workflow` or semantic gaps to `domain-modeling`. Consumer architecture governs fidelity; a narrow logic question does not require a frontend.

## Build and Observe

1. State the question, success criterion, feature scope, and intended fidelity. Build the smallest functional artifact that can answer it.
2. Make every applicable behavior observable. For interactive artifacts, expose navigation, states, actions, ordering, filters, forms, modals, loading, empty, error, disabled, happy-path, and invalid-path behavior through interactions, and render the resulting state.
3. Keep production integration outside the artifact. Place mocks at replaceable system boundaries and inventory each mocked or simulated behavior with its replacement boundary.
4. Capture execution evidence and visual or interaction evidence where applicable. Treat appearance as evidence, not implementation readiness.

## Contract and Disposition

Return the question and success criterion; observed verdict; confirmed and contradicted decisions; discovered behavior and questions; unresolved contradictions; proposed brief delta; mock inventory; evidence; proposed falsifiable contract; risks and deviations; and separate recommended and user-confirmed disposition fields. For UI artifacts, the contract covers components, labels, navigation, states, actions and ordering, filters, forms, modals, and loading, empty, error, disabled, happy-path, and invalid-path behavior.

Use exactly one confirmed disposition: `implementation-candidate`, `reference-only`, or `discard`. Use `implementation-candidate` only for real consumer routes, components, and conventions with replaceable mocks and explicit UI coverage; use `reference-only` for evidence with temporary components, shortcuts, embedded data, or unresolved decisions; use `discard` for incompatible, obsolete, unsafe, or uneconomical artifacts. Record the confirmed disposition and Approved Prototype UI Contract only after explicit user acceptance. Before creating, mutating, or publishing each new Approved Prototype UI Contract version, obtain the user's specific approval for that version. Keep the implementation branch separate from the prototype branch; recover useful code selectively, never through a wholesale cherry-pick. Preserve approved evidence on a durable branch and commit through the consumer's approved workflow. Treat it as evidence and a source of approved decisions, never an automatic implementation base. For an implementation deviation, record its reason and impact, obtain specific user approval, and publish the complete new contract version with a Spanish comment through the consumer's append-only workflow. Functional changes require renewed review; editorial corrections preserving meaning do not.
