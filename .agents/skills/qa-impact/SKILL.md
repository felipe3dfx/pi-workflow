---
name: qa-impact
description: "Trigger: derive supplemental manual regression cases for a pushed ticket candidate, on every new head. Draft a Spanish tracker comment with cases or an evidence-backed no-impact rationale."
license: MIT
metadata:
  author: "Grupo Ilao"
  version: "2.2"
  provenance: original
---

# Analyze Indirect Manual QA Impact

## Activation Contract

Run when `create-pr` pushes a candidate, on the pushed head commit, and again on every new head. Never wait for review. Derive read-only supplemental manual regression coverage for what the change touches indirectly. Edit no file, execute no QA, create no test or capture, publish nothing, and decide nothing about correctness, security, architecture, test sufficiency, or merge.

## Required Inputs

- The approved ticket and specification as behavior authority.
- The consumer playbooks, including QA environments and the issue-tracker comment rules.
- The head commit SHA and the diff since the base at that head.
- The recorded decisions: deviations, accepted risks, and scope expansions from the `implement` handoff and the approved ticket comments. They are settled; never report one as an unresolved exposure.

The head SHA is the evidence identity. A result names it, and it is fresh only while it names the current head; a new head makes it historical and needs a new run.

Report `blocked` when the head, the diff, or a required capability is inaccessible with no documented degraded path, or when approved authorities contradict each other without a governing resolution. Report `incomplete-context` when authority or evidence needed to judge an exposure is missing. Report `ready` only when every relevant exposure has a case or a no-impact rationale.

## Analysis Procedure

1. From the diff, derive the responsibility surfaces the change touches: navigation, authorization, persistence, state, integration, async work, and presentation. Trace each changed unit to the surface it owns by reading the code, never by its path name.
2. Connect each indirect exposure to an evidenced existing journey, integration, state transition, or observable. Claim nothing about whether the implementation works.
3. For each exposure, write one proportional supplemental manual case or an evidence-backed no-impact rationale. A case names the affected journey or integration, trigger, setup, action, expected observable, rationale, and the changed unit it covers.
4. Exclude the ticket's direct scenarios; they belong to the ticket's own acceptance. List an exposure whose evidence is missing as unresolved instead of filling it with a speculative case.

## Output Contract

Return two things:

- **Tracker comment draft**, in Spanish, addressed to the child ticket, or to the parent ticket when the head is a parent integration branch, and never published by this skill. It names the head SHA, visibly states the status token `ready`, `incomplete-context`, or `blocked`, and carries the cases, the no-impact rationales, and any unresolved exposures. Publishing it is a separate effect under the pull-request playbook's approval policy and approval preview, append-only, read back to confirm, with a failure reported as unpublished.
- **Status in prose**: the head SHA, the status, the surfaces analyzed, the excluded direct scenarios, the unresolved exposures and missing evidence, and that a new head needs a new run.

`incomplete-context` needs a human decision. `blocked` is a process failure, never a no-impact result.
