---
name: writing-for-agents
description: "Trigger: write or edit a skill, an AGENTS.md, or any document an agent reads. Shared vocabulary for context load, information hierarchy, pointers, and leading words."
license: MIT
metadata:
  author: "Grupo Ilao"
  version: "1.1"
  provenance: derived
---

# Writing for Agents

Reference for writing any document an agent consumes: a skill, an `AGENTS.md` / `CLAUDE.md`, a doc reached by a pointer. The packaging differs; the writing does not: the same levers make each one predictable, since the agent takes the same _process_ every run rather than producing the same output.

## Precedence

The vocabulary and the levers never yield: context load, cognitive load, the information hierarchy, pointer strength, and leading words are the shared language, and redefining them loses the only thing this skill provides.

Repository policy does take precedence over any concrete recommendation here. The repository's skill style guide governs location, frontmatter shape, licensing, provenance, and the word budget; where it and this document disagree on a specific rule, the style guide decides and this skill informs the reasoning behind it.

## Context pointers

A **context pointer** is a reference held in the agent's context that names some out-of-context material and encodes the condition for reaching it. A skill's description is one; a line in `AGENTS.md` naming a doc is the same object. The pointer's _wording_, not its target, decides when the agent reaches the material, and how reliably. A must-have target behind a weakly worded pointer is a variance bug: sharpen the wording first, and inline the material only if sharpening fails.

A pointer does two jobs: state what the material is, and list the **branches** that should trigger reaching it (a branch is a distinct case the document handles, so different runs take different paths through it). Every word of an always-loaded pointer costs on every turn, so it earns even harder pruning than the body:

- **Front-load the leading word**: the pointer is where it does its triggering work.
- **One trigger per branch.** Synonyms that rename a single branch are one branch written twice; collapse them and keep only genuinely distinct branches.
- **Cut identity the body already carries.**

## The two loads

Every document and pointer you add spends one of two budgets:

- **Context load** is the cost of always-loaded material on the agent's window: an `AGENTS.md` line, a skill description, anything sitting in context every turn, spending tokens and attention whether or not it fires.
- **Cognitive load** is the cost on the human: which documents exist and when to reach for each. The human is the index. Not a cost to minimise: it is the price of human agency; spend it where human judgement matters, remove it where it does not.

Material reached only through a pointer escapes context load at the price of the pointer's own line; material with no pointer at all rides entirely on cognitive load.

## Information hierarchy

A document is built from two content types: **steps** (the ordered actions the agent performs) and **reference** (definitions, rules, facts consulted on demand). The two mix freely: all steps (a recipe), all reference (a review's rules, this skill), or both. The core decision is where each piece sits on the **information hierarchy**, a ladder ranked by how immediately the agent needs the material:

1. **In-file step** is the primary tier: what the agent does, in order.
2. **In-file reference** is consulted on demand. Often a legitimately flat peer-set (every rule of a review on one rung), which is a fine arrangement, not a smell.
3. **Disclosed reference** is pushed out into a separate file, reached by a context pointer, loaded only when the pointer fires. Spans a sibling file in the same folder through fully external reference that lives anywhere and any document can point at.

Push too little down and the top bloats; push too much and you hide material the agent actually needs. That tension is the whole decision.

**Progressive disclosure** is the move down the ladder (out of the main file and behind a pointer) so the top stays legible. Not primarily a token optimisation: it is how the hierarchy is protected. Branching is the cleanest disclosure test: inline what every branch needs, and push behind a pointer what only some branches reach. When a document has steps, in-file reference that should be disclosed buries them and turns attending to them into a coin-flip: a variance lever, not just a legibility one.

## Disclosed reference

Load each file when the work reaches its branch:

- Writing a skill: [`SKILL-MECHANICS.md`](references/SKILL-MECHANICS.md) for frontmatter, invocation choice, splitting by invocation, and router skills.
- Writing steps, or deciding whether one document should become two: [`STEPS-AND-SPLITTING.md`](references/STEPS-AND-SPLITTING.md) for completion criteria, premature completion, legwork, and the sequence cut.
- Choosing the words a document thinks with, or wording a prohibition: [`LEADING-WORDS.md`](references/LEADING-WORDS.md) for leading words and negation.
- Revising an existing document's arrangement or length: [`PRUNING.md`](references/PRUNING.md) for co-location, sprawl, single source of truth, caches, relevance, sediment, and no-ops.
