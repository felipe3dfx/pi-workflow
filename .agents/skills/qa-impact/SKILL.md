---
name: qa-impact
description: "Trigger: derive supplemental manual regression cases for a pushed ticket candidate, on every new head. Draft the Spanish tracker comment that replaces the ticket's single QA comment, with cumulative cases or an evidence-backed no-impact rationale."
license: MIT
metadata:
  author: "Grupo Ilao"
  version: "2.5"
  provenance: original
---

# Analyze Indirect Manual QA Impact

## Activation Contract

Run when `create-pr` pushes a candidate, on the pushed head commit, and again on every new head. Never wait for review. The first head is analyzed from the base; every later head only from the delta since the last analyzed head. Derive read-only supplemental manual regression coverage for what the change touches indirectly. Edit no file, execute no QA, create no test or capture, publish nothing, and decide nothing about correctness, security, architecture, test sufficiency, or merge.

## Required Inputs

- The approved ticket, its specification when one exists, and its published Work Contract comments, when any exist, as behavior authority.
- The consumer playbooks, including QA environments and the issue-tracker comment rules.
- The head commit SHA. On the first head, the diff since the base. On a later head, the QA comment's identity and content, the last analyzed head its "Versión revisada" line names, and the diff since that head.
- The `implement` handoff's requirement-tracing table and the head's review report as coverage report. For a parent integration branch, the children's aggregated `implement` handoffs and the parent's coverage report.
- The recorded decisions: deviations, accepted risks, and scope expansions from the `implement` handoff, or the children's handoffs for a parent, and the approved ticket comments. They are settled; never report one as an unresolved exposure.

The QA comment is the comment on the ticket, or on the parent ticket for a parent integration branch, whose heading is "Casos de regresión manual". Whoever runs this skill looks it up before each run: none makes this the first head; exactly one makes this a later head; more than one is an ambiguous identity. The last analyzed head is the SHA on the QA comment's "Versión revisada" line when it shows Listo. When it shows another status, or that head is not an ancestor of the head, as after a rebase, analyze from the base as on the first head.

The head SHA is the evidence identity. A result names it, and it is fresh only while it names the current head; a new head makes it historical and needs a new run.

Report `blocked` when the head, the diff, the last analyzed head, the QA comment's content, or a required capability is inaccessible with no documented degraded path, when the QA comment's identity is ambiguous, or when approved authorities contradict each other without a governing resolution. Report `incomplete-context` when authority or evidence needed to judge an exposure is missing. Report `ready` only when every relevant exposure has a case or a no-impact rationale. The QA comment shows `blocked`, `incomplete-context`, and `ready` as Bloqueado, Falta contexto, and Listo. Never fabricate a delta or carry coverage forward without its evidence.

## Analysis Procedure

1. From the diff, derive the responsibility surfaces the change touches: navigation, authorization, persistence, state, integration, async work, and presentation. Trace each changed unit to the surface it owns by reading the code, never by its path name.
2. Connect each indirect exposure to an evidenced existing journey, integration, state transition, or observable. Claim nothing about whether the implementation works.
3. For each exposure, write one proportional supplemental manual case or an evidence-backed no-impact rationale. A case names the affected journey or integration, trigger, setup, action, expected observable, rationale, and the changed unit it covers, named in domain language.
4. Exclude the ticket's direct scenarios, as the tracing table and coverage report name them; they belong to the ticket's own acceptance. List an exposure whose evidence is missing as unresolved instead of filling it with a speculative case.
5. On a later head, start from the QA comment: keep each case, rationale, and unresolved exposure the delta leaves valid, revise or drop each one the delta invalidates, and add the delta's new exposures.

## Output Contract

Return two things:

- **Tracker comment draft**, in Spanish, addressed to the ticket, or to the parent ticket when the head is a parent integration branch, and never published by this skill. It is the complete cumulative comment that replaces the QA comment, never an appended one. It starts with the heading "Casos de regresión manual", shows the status as Listo, Falta contexto, or Bloqueado, carries the cases, the no-impact rationales, and any unresolved exposures, and ends with exactly one line "Versión revisada: `sha`" naming the head SHA. It contains no internal status token and no other technical token. Publishing it is a separate effect of whoever ran this skill, under the pull-request playbook's approval policy and approval preview: identify the QA comment again, edit it in place, or create it on the first head, and read it back to confirm, with a failure reported as unpublished. An ambiguous identity, or a QA comment that changed since the run, publishes nothing, so no comment is duplicated. Every other comment stays append-only.
- **Status in prose**: the head SHA, the last analyzed head or the base it started from, the status token `ready`, `incomplete-context`, or `blocked`, the surfaces analyzed, what was kept, revised, dropped, or added, the excluded direct scenarios, the unresolved exposures and missing evidence, and that a new head needs a new run.

`incomplete-context` needs a human decision. `blocked` is a process failure, never a no-impact result.
