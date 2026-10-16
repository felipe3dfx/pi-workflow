---
name: diagnose-bug
description: "Trigger: diagnose a defect or performance regression whose root cause is unknown. Build a tight red loop, reproduce and minimise, test ranked hypotheses, and return the proven root cause."
license: MIT
metadata:
  author: "Grupo Ilao"
  version: "1.0"
  provenance: derived
---

# Diagnose a Bug

## Activation Contract

Use when something is broken, throwing, failing, or slow and its root cause is not established. This skill owns diagnosis: from the reported symptom to a root cause proven by a red loop. The fix and its regression test belong to the caller's test-first loop; scope and behavior belong to the ticket and its authority.

Read the consumer's domain authority and the decision records for the area before exploring the code. Harnesses and probes follow the consumer's coding standards and test conventions.

When a caller runs this skill, its approval rules govern every question and every effect outside the working tree; return them to that caller. A step only the developer can perform, such as a human-in-the-loop run, is always a question, even under an autonomous policy.

## Hard Rules

- **Redact every secret** in commands, outputs, and captured artifacts: write `<REDACTED>` in its place, keep credentials in environment variables, and quote only the lines that carry the signal. When redacted output cannot support the diagnosis, say so and ask.
- Run `git bisect` and every cross-version or differential run in a scratch checkout; the caller's working tree and branch stay as they were. A scratch checkout isolates only git: give it the local environment (env files, local settings, dependencies); give each checkout under test disposable copies of all shared external state (data, queues, storage, indexes), never the development ones, and its own port, or run one at a time, since env files copied with unchanged values isolate nothing; run each version against the schema and data state it expects; run the loop by absolute path or from a copy inside the checkout; and confirm the known-good version green and the known-bad version red there before bisecting. On a HITL loop, the developer, never the agent, runs the whole bisect and pastes `git bisect log` and the culprit commit.
- No hypothesis before a red-capable loop exists. Reading code to build a theory first is the failure this skill prevents.
- Instrumentation, probes, and throwaway prototypes are temporary: remove them before returning. The loop is handed over: keep its command and files in the working tree, uncommitted, so the caller reruns that same loop; the caller removes them after the rerun. Nothing this skill creates is committed.

## Execution Steps

1. **Loop.** Build a feedback loop that goes red on this bug. Try, roughly in order: a failing test at the seam that reaches the bug, an HTTP script against a running dev server, a CLI run diffed against a known-good snapshot, a headless browser script, a replayed captured trace, a throwaway harness over a minimal subset of the system, a property or fuzz loop, a bisection harness for `git bisect run`, a differential run across two versions or configs, and, last, a human-in-the-loop script built from [the HITL template](assets/hitl-loop.template.sh). Be relentless: the loop is most of the diagnosis. Then tighten it: faster, a sharper assertion on the exact symptom, more deterministic (pinned time, seeded randomness, isolated filesystem and network). For a non-deterministic bug, raise the reproduction rate until it is debuggable. Done when one command, already run with its redacted output shown, is red-capable on the reported symptom and deterministic, and either runs in seconds without a human or, when only a human can reproduce the bug, is the HITL script, exiting 1 on the bug, 0 when absent (green), 125 otherwise. The developer runs it in a separate terminal, reports its exit status, and pastes any evidence redacted.
2. **Reproduce and minimise.** Confirm the red is the reported failure, returning to step 1 when it is a nearby one, that it reproduces across runs, and capture the exact symptom. Cut inputs, callers, config, data, and steps one at a time, rerunning after each cut. Done when every remaining element is load-bearing: removing any one turns the loop green.
3. **Hypothesise.** Rank three to five falsifiable hypotheses before testing any, each with its prediction: "if X is the cause, changing Y makes the bug disappear." Discard or sharpen one with no prediction. Show the ranked list to the developer and proceed without waiting.
4. **Instrument.** Map each probe to one prediction and change one variable at a time. Prefer a debugger or REPL, then targeted logs at the boundaries that separate hypotheses; tag every log with a unique prefix such as `[DEBUG-a4f2]`. For a performance regression, measure a baseline first and bisect against it. Done when one hypothesis survives its prediction and the others are falsified or out-ranked with evidence.
5. **Seam.** Judge whether a correct regression seam exists: one where a test exercises the real bug pattern as it occurs at the call site. A seam too shallow to replay the triggering chain is no seam; record its absence as an architectural finding.
6. **Cleanup.** Remove every tagged log, found by grepping its prefix, and every probe or throwaway prototype. Keep the loop's files for the caller's rerun. Done when only the loop's files remain from this diagnosis.

## Decision Gates

- No red-capable loop after exhausting the options: **blocked**. List what was tried and ask for access to an environment that reproduces it, a redacted captured artifact (HAR file, log or core dump, timestamped recording), or permission for temporary production instrumentation.

## Output Contract

- the reported symptom and the loop command, with its redacted red output;
- the minimised reproduction, every element load-bearing;
- the ranked hypotheses, each with its prediction and verdict, and the proven root cause with its evidence;
- the correct regression seam, or the no-correct-seam finding;
- the cleanup confirmation naming the kept loop's files and whether the loop needs a human, or the blocker with what was tried and what is needed.

Next: the caller's test-first loop turns the minimised reproduction into a failing test at that seam, fixes it, reruns the original loop green, and removes the loop's files before its next commit; the commit or handoff states the proven root cause.
