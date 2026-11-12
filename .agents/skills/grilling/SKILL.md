---
name: grilling
description: "Trigger: grill or stress-test a plan, decision, or definition. Interview the user one question at a time until the scoped decisions are settled or blocked."
license: MIT
metadata:
  author: "Grupo Ilao"
  version: "1.0"
  provenance: derived
---

# Grilling

## Activation Contract

Use this skill to run a scoped decision interview on a plan, decision, or definition, for a calling skill or for the user directly. It owns how the scoped questions are asked and how the answers return. The caller keeps its own discovery, brief, critique, approvals, and acceptance; glossary and ADR changes stay with `domain-modeling`.

## Hard Rules

- The decisions are the user's: every material choice, intent, and risk acceptance. Recommend, and leave the choice to the user.
- Finding facts is your job. Answer from the supplied artifacts, repository evidence, and the environment before asking, and ask only what they leave open.
- Reuse each decision a supplied authoritative artifact already resolves, citing its source. Reopen it only on new material evidence, a change it depends on, or the user's request.

## Interview

1. Ask only a question whose prerequisites are settled; one that depends on an unanswered decision waits until that decision closes. Keep the remaining decisions as working reasoning, and follow only the branches the scope needs.
2. Ask one question per turn. Show the evidence and its sources, the options that differ in consequence with their tradeoffs, and your recommended answer grounded in that evidence. When evidence supports no recommendation, ask for the missing intent or information instead of inventing one. Otherwise word the question so "yes" accepts the recommendation.
3. Record the answer as the user's exact decision with its reason, consequences, and source, then pick the next askable question.
4. Stop when every scoped question is settled, or when a decision needs input that is unavailable. Record each unanswered or unavailable decision as an open blocker; only the user's answer settles it.

## Output Contract

Return each decision as the user stated it, with its reason, consequences, and sources; each reused decision with its source; and each open blocker with the input it waits on. Hand this record back as the result: the caller's own acceptance closes it, so ask no separate confirmation round.
