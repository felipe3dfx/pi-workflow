# Skill Provenance

## Source

1. Original material: Anthropic's `claude-plugins-official/plugins/code-simplifier/agents/code-simplifier.md` at immutable revision `f7d3b68ad67a26bab832e8a3b2693f1e192cf564` (`Add Apache 2.0 LICENSE to all internal plugins`), where the material and Apache License 2.0 coexist.
2. Intermediate Grupo Ilao consumer adaptation: `ilaos-website/.agents/skills/simplify/SKILL.md` at immutable revision `71529c277cfc4688f0ffdb5b7653e4b18c8dd9f2`; `prepare-commit/SKILL.md` and `review-feedback-triage/SKILL.md` were reviewed as related evidence.
3. Licensing evidence: `anthropics/claude-plugins-official/plugins/code-simplifier/LICENSE` at the same immutable revision `f7d3b68ad67a26bab832e8a3b2693f1e192cf564`.

## Author or owner

The original plugin manifest at `f7d3b68ad67a26bab832e8a3b2693f1e192cf564` identifies Anthropic (`support@anthropic.com`) as its author. The material contains no copyright notice, and the co-located `LICENSE` and absent `NOTICE` file do not establish a named copyright rightsholder. The intermediate consumer adaptation is a Grupo Ilao change: the pinned consumer adaptation was authored by Felipe Gonzalez and Nicolas Vargas. Grupo Ilao authored this shared-catalog adaptation.

## License or terms

At `f7d3b68ad67a26bab832e8a3b2693f1e192cf564`, the original material and its Apache License 2.0 file coexist. This derived `simplify` artifact remains Apache-2.0, aligned with ADR 0003.

## Notice

Copyright 2026 Grupo Ilao. Licensed under the Apache License, Version 2.0. Grupo Ilao modified the adapted material for this shared catalog.

## Retrieved

Retrieved: 2026-08-31.

The intermediate artifact was retrieved from the local `ilaos-website` checkout; consumer skill versions 1.2.0 (`simplify`), 1.1 (`prepare-commit`), and 1.3 (`review-feedback-triage`). GitHub's immutable contents endpoint verifies that `f7d3b68ad67a26bab832e8a3b2693f1e192cf564` contains both the material, unchanged from `ceb9b72b4c4c20ad39efce780edd0aabe80ebce3`, and `plugins/code-simplifier/LICENSE` with the Apache License 2.0 text.

## Material used

The bounded-diff, behavior-preserving simplification approach; abstraction-budget comparison; evidence-backed finding format; and separation of simplification from broader review and readiness.

## Modifications

Grupo Ilao removed Django, framework, command, language, editing, and multi-agent implementation details. It made the capability universally read-only, capture-scoped, and agent-agnostic; added temporary-capture freshness, pertinence, and explicit ownership handoffs to independent review.

## Approval

Internal reuse under Apache-2.0 was approved by the Issue #17 group specification.
