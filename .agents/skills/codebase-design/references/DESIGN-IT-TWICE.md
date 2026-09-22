# Design It Twice

When the user wants to explore alternative interfaces for a chosen deepening candidate, produce several genuinely different designs before committing to one. Based on "Design It Twice" (Ousterhout): your first idea is unlikely to be the best.

Uses the vocabulary in [SKILL.md](../SKILL.md): **module**, **interface**, **seam**, **adapter**, **leverage**.

## What must be established

Independent of how the work is carried out:

- at least three interfaces that differ **radically**, not in detail;
- each designed against a distinct constraint, so the set spans the space rather than clustering;
- each authored in a fresh context that cannot see the others, so no design anchors on an earlier one;
- a comparison across all of them on depth, locality, and seam placement;
- one opinionated recommendation.

How that happens belongs to the harness. Parallel isolated agents satisfy it; so does running them one after another, as long as each starts from a fresh context. Concurrency is not the requirement, isolation is: a single context working through the constraints in sequence cannot unsee its own drafts, and its later designs will converge on its earlier ones.

## Process

### 1. Frame the problem space

Before designing, write a user-facing explanation of the problem space for the chosen candidate:

- The constraints any new interface would need to satisfy
- The dependencies it would rely on, and which category they fall into (see [DEEPENING.md](DEEPENING.md))
- A rough illustrative code sketch to ground the constraints, not a proposal, just a way to make the constraints concrete

Show this to the user, then proceed. The user reads and thinks while the designs are produced.

### 2. Produce the designs

Each design gets its own technical brief: file paths, coupling details, dependency category from [DEEPENING.md](DEEPENING.md), and what sits behind the seam. The brief is independent of the user-facing problem-space explanation in Step 1.

Give each design a different constraint:

- **Minimal**: 1–3 entry points at most. Maximise leverage per entry point.
- **Flexible**: support many use cases and extension.
- **Common case**: optimise for the most frequent caller. Make the default trivial.
- **Ports & adapters** (when cross-seam dependencies exist): design around the port.

Include both [SKILL.md](../SKILL.md) vocabulary and the project's glossary in each brief, so every design names things consistently with the architecture language and the domain language.

Each design outputs:

1. Interface (types, methods, params, plus invariants, ordering, error modes)
2. Usage example showing how callers use it
3. What the implementation hides behind the seam
4. Dependency strategy and adapters (see [DEEPENING.md](DEEPENING.md))
5. Trade-offs: where leverage is high, where it's thin

### 3. Present and compare

Present designs sequentially so the user can absorb each one, then compare them in prose. Contrast by **depth** (leverage at the interface), **locality** (where change concentrates), and **seam placement**.

After comparing, give your own recommendation: which design you think is strongest and why. If elements from different designs would combine well, propose a hybrid. Be opinionated: the user wants a strong read, not a menu.
