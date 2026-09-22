---
name: setup-workflow
description: "Trigger: configure repository workflow playbooks or audit existing drift. Discover consumer policy, confirm it by playbook, and write durable agent contracts."
license: MIT
metadata:
  author: "Grupo Ilao"
  version: "1.3"
  provenance: derived
---

# Set Up Repository Workflow

Configure repository-level playbooks. For every script step, invoke `python3` with the absolute path of the installed `scripts/setup_workflow.py` beside this `SKILL.md`; never search for it. A missing or non-regular script blocks the step.

## Hard Rules

- Use cheap, side-effect-free probes: help, version, and remotes. Discovery does not run the repository's validation suite.
- Exclude credentials, credential variable names, and authorization details from findings and generated files.
- Repository evidence supplies candidates; machine probes supply capability states. Record a candidate only when repository files, configuration, or history demonstrate it; idiom and ecosystem convention are insufficient. Record one capability state and every observed mechanism.
- Unconfirmed values remain unresolved markers. A user-confirmed or repository-stated absence is `none (confirmed absent)` with its evidence. A value slot contains only a marker, `none (confirmed absent)`, or the candidate exactly as the repository spells it; prose belongs in discovery fields, not value slots.
- Each capability carries exactly one state from [references/runtime-contract.md](references/runtime-contract.md); propagate a stated absence to dependent capabilities, count candidates per governing value, and count a standalone capability separately.
- With a Linear tracker, `CHILD_BRANCH_CONVENTION` is the pattern `<KEY>-<number>` built from the resolved Linear team's key (`ENG-<number>`, never a literal identifier); branch history, prefix styles, and slugs supply no candidate, and an unresolved key leaves a marker.
- The contracts in [assets/pull-requests.md](assets/pull-requests.md) are fixed and never rediscovered or asked for; resolve its remaining tokens normally.

## Discover and Confirm

1. Inspect the root instruction file, `docs/agents/`, remotes and branches, tracker evidence, domain authority, validation conventions, and pull-request practice. Surface unrelated `docs/agents/` files for confirmation. Discovery ends when every template value and capability has repository evidence or an unresolved status.
2. If root `AGENTS.md` is absent, stop before writing and resolve it first. Propose the harness's named initializer when it offers one; otherwise a minimal `AGENTS.md` carrying a title, one discovered repository line, and the routing block. Present one proposal, never an unqualified choice. Its approval may be collected before, with, or after other playbook findings, but `AGENTS.md` is never written before its own explicit approval.
3. Present findings in routing-block order, instruction file first. An existing recorded value is resolved but still compared; a surviving marker is reported. Repeated occurrences count once. One verified candidate skips its question; multiple require the user's choice; zero require confirmed absence or a supplied candidate. Batch unresolved values per playbook into one question. Working, production, and parent branches are recorded or marked unresolved, never gated.
4. Resolve and record the Domain Authority Handoff by the exclusive states in [references/runtime-contract.md](references/runtime-contract.md), proving a map with the installed `context-map` validator.

## Write and Re-run

Every run, before any write, including the first:

1. Run `python3 <absolute-installed-setup-workflow.py> diff`, feeding each token its recorded value where an existing playbook records one, else the run's confirmed value, never rediscovered wording. The script finds form drift only; whether the repository contradicts a recorded value is discovery's judgment.
2. Present recorded values as confirmed — value, file, and evidence — and work only the delta: unresolved markers, contradicted values, and sections the contract defines and the file lacks. Present one proposal covering every file to create or update, with the preserved value beside each change, and take its exact diff from `update` without an approval, so the proposed bytes are the written ones. A difference is a contradiction, never an alternative; a rival candidate beside a recorded value is not one.
3. Wait for the user's explicit approval for every file that will be written. A single verified candidate skips its question, never this approval. A run with nothing missing reports differences, writes nothing, and asks for no approval.
4. Write missing files with `python3 <absolute-installed-setup-workflow.py> render --approve <file>`, keeping its values file in a temporary directory and never in the consumer repository; a confirmed absence selects `issue-tracker-none.md`. Update an existing playbook with `python3 <absolute-installed-setup-workflow.py> update --approve <file>`, which re-renders the current asset from the values already recorded. Where root `AGENTS.md` has no routing block, `python3 <absolute-installed-setup-workflow.py> routing --append --approve AGENTS.md` writes [assets/routing-block.md](assets/routing-block.md) byte for byte; add no policy text.

The write guards, the domain withhold, the outside-path refusal, and the no-interpreter degraded path are [references/runtime-contract.md](references/runtime-contract.md).

## Report

List confirmed playbooks, created or updated files, unresolved markers, capability states, unrelated `docs/agents/` files, every difference, and any refusal or blocked step. Name the workflow phases each `unsupported` capability disables.

## References

- Runtime: Load [`runtime-contract.md`](references/runtime-contract.md) when resolving the Domain Authority Handoff, recording a capability state, or before any write.
- Maintainer: [`behavioral-scenarios.md`](references/behavioral-scenarios.md) is the conformance table for reviewing this skill; a run does not need it.
