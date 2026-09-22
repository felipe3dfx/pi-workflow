---
name: implement
description: "Trigger: implement one approved child ticket. Produce an uncommitted, verified handoff through TDD and the required review loop."
license: MIT
metadata:
  author: "Grupo Ilao"
  version: "1.0"
  provenance: derived
---

# Implement a Child Ticket

## Activation Contract

Implement exactly one approved child ticket in a fresh session. Consume its handoff, authority, and consumer workflow contract. Construct the candidate and coordinate `tdd`, `simplify`, optional `mutation-testing`, an available independent reviewer, and adversary; those capabilities retain their contracts. The available reviewer fulfills this invocation's independent-review requirement; it does not implement #19's shared review/feedback workflow. Do not implement #18 scope/QA impact or #20 commit preparation or PR creation.

## Preconditions and Boundaries

Require the ticket, authority, consumer contracts, and a functioning validation path. Propose the child branch from the recorded parent integration branch, not the production base, using the consumer's issue convention; the developer may change it. Identify this group as `issue-17`. Recover approved prototype code selectively, never as a base or wholesale cherry-pick.

Ask the harness for TDD, read-only simplify, independent review, adversary, isolation, and bounded validation. Review, adversary, and implementation must use non-overlapping actors or isolated contexts, with harness evidence; missing independence blocks. Missing required capability, unresolved governing-authority or required-contract contradiction, or nonfunctioning candidate is `blocked`. The no-valuable-test-seam exception applies only to TDD; unavailable simplify, independent review, or adversary always blocks. Developer owns scope, discretionary findings, and accepted risks; preferences and approved expansion do not block. Any behavioral change or authority/UI-contract deviation needs an explicit decision; record authority changes through ADR 0011 and UI changes through ADR 0005.

## Execution

1. Confirm one ticket, its public behavior seams, branch/base proposal, and visible mode: `auto-apply-confirmed` or `approval-required`. In `auto-apply-confirmed`, apply confirmed findings without separate approval for each change; in `approval-required`, obtain approval before each confirmed change. Run `tdd` for meaningful behavior; record a no-valuable-test-seam exception when justified.
2. Work vertically and run consumer type checks, focused tests, and the full suite regularly. Recover from failed edits or checks; retain local work uncommitted. On cancellation, preserve it without stash or discard and report the last verified frontier. Resume only after fresh validation and a new capture.
3. Only after initial quality and pertinence validation, capture ticket; branch/base; selected scope; changed paths and diff; each behavior name and seam's RED/GREEN evidence; test and quality commands with results; application/rejection, scope, deviation, and risk decisions; and uncommitted state. Reuse it unchanged; regenerate it after every edit or any material change to facts it records. Never commit, identify, or distribute it.
4. Run `simplify` and independent review, then adversary through the qualified independent actors or contexts. Independent review covers functional correctness, tests and seams, architecture, security, regressions, scope, pertinence, and evidence. The adversary must try to refute every simplify or independent-review finding and return `confirmed`, `refuted`, or `uncertain` with evidence. Every new finding goes through adversary, developer disposition and required application, capture refresh, affected checks, and review again until terminal. Apply confirmed findings under the selected mode; require a developer disposition for every uncertain finding. A request for more evidence remains incomplete until reclassification or explicit acceptance/rejection. Refuted and rejected findings keep their rationale.
5. Run optional bounded mutation testing when supported. It informs the developer and never blocks solely by being unavailable. If mutation evidence leads to a test or code edit, invalidate and refresh the candidate capture, rerun affected checks, then complete the full independent-review, adversary, and finding-application loop before completion.

Every scope expansion, authority or prototype-contract deviation, rejected finding, or accepted risk requires an explicitly developer-approved, append-only Spanish issue comment stating the decision, reason, and impact. That comment is the only external effect; prohibit every other external effect.

## Output Contract

Return ticket/native relationships, branch/base proposal, final diff, behavior seams with RED/GREEN evidence and exceptions, checks, capture refreshes, independence qualification, finding dispositions, mutation result, decisions/deviations/risks, cancellation or blockers, approved issue comment, #18/#19/#20 handoffs, and no commit. Complete only with green checks, terminal findings, and required traceability.
