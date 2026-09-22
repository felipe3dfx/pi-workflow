# Domain Docs

How workflow skills should consume this repository's domain documentation when exploring the codebase.

## Before Exploring, Read These

- Domain authority: `{{DOMAIN_AUTHORITY_PATH}}`
- Context map: `{{CONTEXT_MAP_PATH}}`
- Architectural decisions: `{{ADR_PATHS}}`

The context map and the decision records are optional. When authority is absent, its recorded path is where `domain-modeling` may establish it, never evidence that it already exists.

## File Structure

`{{DOMAIN_LAYOUT_DESCRIPTION}}`

`setup-workflow` owns map discovery and the `context-map` validator. `CONTEXT_MAP_PATH`, `DOMAIN_AUTHORITY_PATH`, and `DOMAIN_AUTHORITY_STATE` must agree on one mutually exclusive state: `present (map-available)` names a valid root map and requires `DOMAIN_AUTHORITY_PATH` to be `none (select per invocation)`; `present (root-selected)` names the sole case-folded root glossary; `absent (fallback-required)` names this file's delimited region as the future authority; or `present (fallback-established)` names that populated region as the authority. For a map, the installed `domain-modeling` skill invokes that validator before each mutation and consumes only that invocation's `context <label>\t<repository-relative CONTEXT.md>` output. Match the current topic with explicit repository or user evidence: zero matches block, one match selects that glossary for this invocation, and multiple matches require the user's choice. A case-fold duplicate, invalid map, unreachable entry, or inconsistent value blocks mutation. Do not create another glossary or repair this contract.

<!-- domain-modeling:authority:start -->
Authority state: {{DOMAIN_AUTHORITY_STATE}}
<!-- domain-modeling:authority:end -->

## Use the Glossary's Vocabulary

When an issue, specification, proposal, test, or output names a domain concept, use the term defined by domain authority. If the concept is absent, either reconsider the wording or record the gap for `domain-modeling`.

## Flag Decision Conflicts

If a proposed change contradicts an applicable architectural decision, surface the conflict explicitly. Do not silently override an existing decision.
