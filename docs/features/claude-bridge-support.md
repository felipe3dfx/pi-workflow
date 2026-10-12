# Claude Bridge support

## Status and authority
Proposed functional brief; approval does not authorize implementation.
Canonical vocabulary: GLOSSARY.md, root-selected by docs/agents/domain.md.
No Bridge-specific generated authority handoff exists. This documented absence
does not require a repository edit before planning.
Business intent belongs to the developer; this brief does not change canon.

## Problem, user, and outcome
An operator wants Claude Bridge models in the parent session and Specialists
without replacing the harness's delegation, Contracts, tools, or lifecycle.
The stock child factory rejects Bridge requests at prompt capture.
Support must preserve those contracts rather than copy the parent's prompt.

## Scope and decisions
Accepted by the developer in feature discovery:
- Support the Bridge provider in the parent and all three Specialists.
- Use the official Bridge extension through Pi's public child lifecycle.
- Exclude AskClaude from this feature and from active child tools.
- Prove support before including Bridge in the Companion catalog.
- Preserve and document existing cancellation issues; do not fix them here.
No accepted decision supersedes another.

Proposed for approval:
- Preserve catalog validation and existing model/thinking inheritance.
- Reject an unavailable explicit model before launching a child.
- Surface provider, authentication, and prompt errors without silent fallback.
- Treat the scratch prototype as reference-only, not implementation code.

Out of scope: automatic installation, global configuration/auth changes,
absorbing Bridge source, new delegation tools, and continuing non-completed children.

## Scenarios and observable invariants
1. The operator explicitly selects a Bridge model or Specialist Model profile.
2. An unavailable explicit model is refused with an actionable diagnostic.
3. Before the first child request, the official extension captures that child's
   Contract and permitted context, without parent-only delegation instructions.
4. Role tool projections, nested codemode, ask_parent, and report_result remain
   unchanged; Explorer has no repository context, Worker/Verifier retain theirs.
5. Model and thinking selection follow existing profile/inheritance rules.
6. Results, Steer, cooperative cancellation, and terminal Run states retain
   current behavior; cancellation is not a security or OS-isolation guarantee.
7. A completed child may continue in a distinct child with saved conversation.
   Failed, cancelled, and timed-out sources remain refused.
8. Provider failure never installs software, broadens tools, or selects another model.

## Shared capabilities and comparisons
Reuse Model profiles/catalog selection, role Contracts, curated child extensions,
result delivery, and completed-child continuation; do not add parallel delegation.
Unlike the stock factory, the scratch candidate loads the official Bridge extension.
The harness extension remains absent from children; no spawn_child or child skills.

## Prototype evidence and disposition
Tested: Pi 1.1.0, Bridge 0.9.2, Claude Code 2.1.296, Haiku 4.5 with low thinking.
Real parent-like calls passed; full harness parent context was checked offline.
Real adapted Worker, Explorer, Verifier, nested tools, reporting, steering, and
completed-child continuation passed. The stock factory remains incompatible.
Synthetic context, scratch fixtures, and an adapted factory limit these findings.
Offline simulated-provider comparisons establish cancellation baseline only.
Proposed disposition: reference-only; production integration still needs tests.
Sources: upstream revision b2e7255ece0b8bfd3a6429fd5c147fd59984c785;
scratch evidence under /tmp/pi-claude-bridge-prototype.YmrJ75/.

## Risks, dependencies, and evidence gaps
Bridge must be independently installed and registered; no automatic installation.
Its shared prompt cache retains up to 256 lookup keys; inheritance references may
retain other objects. No unbounded leak was demonstrated; preserve upstream behavior.
Cancelled sessions may retain an unmatched tool call and emit a stale-context warning.
This also occurred without Bridge and is an accepted baseline limitation.
Live cancellation reached cancelled; universal post-cancel process cleanup is unproven.
Evidence covers one model/version combination, not every Bridge catalog model.
Production parent/child integration and supported-version coverage remain delivery
acceptance criteria, not claims established by the scratch prototype.
ADR 0014's curated extension list needs an accepted amendment before delivery.
No glossary change, private registry cleanup, or prompt-capture bypass is proposed.

## Readiness and sources
Approval closes the proposed intent and reference-only disposition for feature-review.
There is no independent feature-review or verifier pass yet.
Latest npm run check failed in fixture commits through the 1Password signing agent:
823 passed, 31 failed, 1 skipped. Signing configuration was not changed.
Sources: GLOSSARY.md; docs/agents/; ADRs 0005 and 0014; child-session specs;
extensions/child-sessions.ts, child-launcher.ts, model-profiles.ts;
assets/contracts/; assets/companions.json; pinned Bridge source and scratch evidence.
Implementation, catalog adoption, and publication require their later workflow.
