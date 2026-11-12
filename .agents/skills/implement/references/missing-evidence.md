# Missing Scratch Evidence

Read this file in full before step 1 when the quality playbook records no `supported` Scratch Evidence state, and at Review whenever Valuable Tests blocks on missing evidence, including a scratch setup failure or a run that touched shared state without recorded isolation.

## Before step 1

When the quality playbook records no `supported` Scratch Evidence state, tell the developer once that Valuable Tests will block at Review and that publishing will need that risk accepted. The notice never blocks: Seams, Build, and Checkpoint proceed when their own prerequisites hold.

## At Review

Apply the scratch evidence gate in step 4; Valuable Tests blocks on missing evidence, and Standards and Spec still report. Ask the developer one question: accept the risk and continue to the handoff, or stop. An explicit earlier instruction from the developer to publish without more review is that answer: continue without asking the risk question again. That instruction answers only the risk question, never the findings.

After acceptance, the run continues through Critique and Fix, steps 5–6, to the handoff as usual.

An accepted block is an accepted risk: publish it as the append-only Spanish issue comment per [decision recording](decision-recording.md), after its approval preview where the policy asks, and carry it in the handoff's accepted risks. Report the axis as blocked and accepted, never as reviewed, passed, or approved. An accepted block does not prevent completion.

The acceptance holds for the whole ticket, across later heads and rounds, while its cause is unchanged. A different cause, such as a scratch setup failure, asks again.

## What acceptance never covers

- A hard finding without a verdict.
- A missing `code-review` report for the head.
- Red focused checks.
- `create-pr`'s publication gate.
- A candidate whose identity changed during the scratch runs: review the committed head again.

Scratch never runs on shared databases or services without recorded isolation.
