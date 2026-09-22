---
name: domain-modeling
description: "Trigger: resolve or evolve canonical domain language, or record a consequential architecture decision. Maintain glossary authority and ADRs through their declared contracts."
license: MIT
metadata:
  author: "Grupo Ilao"
  version: "1.0"
  provenance: derived
---

# Domain Modeling

## Activation Contract

Use this skill to resolve or evolve canonical domain language, or to record a consequential architecture decision. Reading domain authority to use its vocabulary is supporting work for the invoking skill, not activation of this one.

Actively sharpen the model: challenge conflicting terms, tighten vague or overloaded language, test relationships with concrete edge-case scenarios, and check stated behavior against repository evidence. Show contradictions between glossary, accepted ADRs, and code; code demonstrates current behavior, not desired behavior. The user decides every contradiction.

## Authority Contract

Read `AGENTS.md`, then the resolved `docs/agents/domain.md` contract. `setup-workflow` exclusively discovers the layout, validates the map, generates and validates its shell and exact authority markers, and reports drift. Its recorded Domain Authority Handoff is the only location input to this skill: `CONTEXT_MAP_PATH`, `DOMAIN_AUTHORITY_PATH`, and `DOMAIN_AUTHORITY_STATE`. Do not rediscover a location, repair a map or shell, normalize files, or create a legacy migration path.

The handoff has exactly one authority state. `present (map-available)` requires one valid root `CONTEXT-MAP.md`, its recorded path, and `DOMAIN_AUTHORITY_PATH = none (select per invocation)`; it intentionally names no glossary. `present (root-selected)` requires exactly one case-folded root `CONTEXT.md` and its recorded case-preserved path. `absent (fallback-required)` requires no root map exists and no root glossary, and names only the marked region in `docs/agents/domain.md` as the future authority. `present (fallback-established)` requires that same fallback region to contain the glossary. The map state leaves the fallback region non-authoritative while exposing candidates; root selection names an external target and leaves the fallback region non-authoritative; fallback states require `docs/agents/domain.md` as the target and no external authority. These states are mutually exclusive.

For `present (map-available)`, resolve the installed `setup-workflow` sibling from the directory containing this `SKILL.md`, not from the consumer repository's current working directory. Invoke `python3 <absolute path to ../setup-workflow/scripts/setup_workflow.py>` with `context-map --repo <consumer-repository>`; never search the filesystem for the script. If that sibling path is missing or is not a regular file, fail closed and report an incomplete skill installation. Before every mutation, run that validator and use its complete validated entry list. Compare the current topic to entries only through explicit user or repository evidence collected in this invocation. Zero matching entries blocks the mutation and reports the evidence gap. One matching entry selects that glossary for this invocation only. Multiple matching entries requires one user question that names the matching entries; wait for the answer. Topic wording, label similarity, directory proximity, a previous selection, and unstated heuristics are not evidence and never select an entry. Revalidate before writing; a changed, invalid, unreachable, duplicated, malformed, or inconsistent map blocks the change and routes diagnosis to `setup-workflow`. Never use root or fallback authority while a map exists.

For root and fallback states, before a mutation make the minimum non-mutating check that the recorded handoff and target are present, internally consistent, unambiguous, repository-contained, and writable. Use only the target that matches its state. Any failed check blocks the change. For a map-selected-invocation or root-selected glossary, change only that document. For `docs/agents/domain.md`, change only the region between `<!-- domain-modeling:authority:start -->` and `<!-- domain-modeling:authority:end -->`; `Authority state: absent (fallback-required)` changes to `present (fallback-established)` with the first glossary term, and the populated region is its single glossary. Never alter the generated shell.

## Glossary Work

Obtain a user-accepted canonical name, tight definition, useful aliases, a concrete scenario, repository evidence when present, and no unresolved contradiction before writing. Update the confirmed term inline. Persist only the canonical term, a one- or two-sentence implementation-free definition, and useful `_Avoid_` aliases. Keep scenarios, evidence, impact, and dispositions in the invocation report.

Before renaming, splitting, merging, or redefining a term, search its glossary, ADR, and relevant repository impact. Propose only the approved glossary scope; leave dependent code and other artifacts unchanged unless separately approved. Follow [the glossary format](references/CONTEXT-FORMAT.md) when creating or editing the authority.

## ADR Work

Offer an ADR only when the decision is hard to reverse, surprising without context, and the result of a real trade-off. Otherwise do not create one. ADRs live only in root `docs/adr/`; follow [the ADR format and lifecycle](references/ADR-FORMAT.md). Follow the consumer's recorded language and presentation conventions unless a higher-priority workflow invariant applies.

For a new ADR, prepare the complete proposed bytes and exact path, then follow [the ADR format and lifecycle](references/ADR-FORMAT.md) as the lifecycle authority. Before merge, an approved revision may replace only a file whose same-PR ownership the lifecycle rules establish. Report the lifecycle action. Downstream target checks remain owned by #19 and #20; handoffs receive only a read-only Domain Authority review.

## Report

Report the durable setup-produced Domain Authority Handoff consumed, changed paths, resolved terms and scenarios, contradictions and user dispositions, ADR lifecycle actions, and impacted references left unchanged. For ADR work, record the exact path; destination identity and captured target OID; merge-base/current-diff ownership evidence; prefix/path collision result; exact-byte approval; allowed-section diff result; freshness recheck; conditional compare-and-swap/publication result; and exact-byte read-back, marking inapplicable evidence as such. ADR work completes only when the approved bytes are read back at that path against the recorded target OID, or it reports a blocking failure. For a map invocation, report the validated entries, current-invocation evidence, and whether it blocked, selected one, or required the user's choice; the contextual glossary selection is per-invocation and non-persistent. Report only what this invocation established.
