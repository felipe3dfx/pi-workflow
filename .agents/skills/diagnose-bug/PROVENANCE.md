# Skill Provenance

## Source

<https://github.com/mattpocock/skills/tree/24fe0ef7737efae15c87225755e9f6f5965e4888/skills/engineering/diagnosing-bugs>: `SKILL.md` and `scripts/hitl-loop.template.sh`.

## Author or owner

Matt Pocock.

## License or terms

MIT.

## Notice

Copyright (c) 2026 Matt Pocock

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Retrieved

2026-10-16, from `mattpocock-skills` version 1.3.1 at commit `24fe0ef7737efae15c87225755e9f6f5965e4888`.

## Material used

The redaction rule; the feedback-loop phase with its ordered construction options, loop tightening, non-deterministic reproduction rate, the cannot-build-a-loop stop, and the tight red-capable completion criterion; reproduction and minimisation until every element is load-bearing; three to five ranked falsifiable hypotheses shown to the user without blocking; one-variable instrumentation with tagged debug logs and the measure-first performance branch; the correct-regression-seam judgment and the no-seam finding; and the cleanup checklist. `scripts/hitl-loop.template.sh` is adapted as `assets/hitl-loop.template.sh`. The upstream `agents/openai.yaml` was not used.

## Modifications

1. Renamed `diagnose-bug`; frontmatter rewritten to this catalog's shape with a `Trigger:` description.
2. Narrowed to one responsibility, diagnosis, ending at a root cause proven by a red loop. Upstream's fix phase is removed: writing the regression test and the fix belongs to the caller's test-first loop, which receives the minimised reproduction, the regression seam or no-seam finding, and the original loop to rerun green. Upstream's instruction to state the correct hypothesis in the commit or PR becomes the output's proven root cause, which the caller's commit or handoff states.
3. The phases are restated as numbered execution steps, each with a completion criterion; the instrumentation step completes when one hypothesis survives its prediction.
4. The project glossary and ADRs become the consumer's domain authority and decision records; harnesses and probes follow the consumer's coding standards and test conventions.
5. Added that a calling skill's approval rules govern every question and every effect outside the working tree, that nothing the diagnosis creates is committed, and that the loop is handed to the caller for its green rerun while probes and prototypes are removed; a human-in-the-loop script satisfies the loop criterion when only a human can reproduce the bug, and every step only the developer can perform is a question even under an autonomous policy. The developer, not the agent, runs a human-in-the-loop script in a separate terminal, reports the `exit=N` it prints, and pastes any evidence redacted. `git bisect` and cross-version or differential runs happen only in a scratch checkout, never in the caller's working tree; the scratch checkout gets the local environment, each checkout under test gets disposable copies of all shared external state (data, queues, storage, indexes), never the development ones, and its own port, or the runs go one at a time, each version runs against the schema and data state it expects, the loop runs by absolute path or from a copy inside the checkout, and the known-good version is confirmed green and the known-bad version red there before bisecting; on a human-in-the-loop loop the developer runs the whole bisect and pastes `git bisect log` and the culprit commit.
6. The cannot-build-a-loop stop becomes a **blocked** decision gate with the same three requests; a loop red on a nearby failure returns to the loop step.
7. Added an output contract listing the symptom and loop, the minimised reproduction, the hypotheses with verdicts and the root cause, the seam judgment, and the cleanup or blocker.
8. The HITL template is modified and moved from `scripts/` to `assets/`, the catalog's place for templates. It keeps `step` and drops upstream's `capture` and its `KEY=VALUE` output: the header says the developer runs it in a separate terminal and reports the printed `exit=N`; the edited steps run in a subshell under `set -euo pipefail`, so their traps, variables, and shell options cannot reach the verdict, and the top level, under `set -uo pipefail`, checks the subshell's status as a separate command and exits 125 when it is not 0; every exit goes through a `finish` function that prints `exit=N` as the last output line and exits with N; the template ends with one question, "Did you observe the bug? (y/n)", whose answer, trimmed at the ends and ignoring case, exits 1 for `y` or `yes` and 0 for `n` or `no`, so green is exit 0, and 125 for any other answer, empty included; a step or the question with no input on stdin stops with a message to run it in an interactive terminal and exits 125. Failures that `set -e` detects in the edited steps exit 125, so only the answer decides 0 or 1 and `git bisect run` skips the rest. A syntax error in the edited steps makes bash exit 2 without the `exit=` line on every commit, an accepted loud failure that the known-good confirmation catches. Ctrl-C ends the run by the interrupt signal without the `exit=` line, also an accepted loud failure.
9. Added `tests/hitl_loop_test.sh`, which feeds the template scripted input and checks its exit status and, except for a syntax error, that the last output line is `exit=` with that status: yes and no answers with spaces, uppercase, or a carriage return, empty, ambiguous, `n o`, or `y es` answers exiting 125, a run without input on stdin, or one that ends before the answer, exiting 125 with its interactive-terminal message; a failing command, a failing pipeline stage, or an unset variable in the edited steps exiting 125; edited steps that assign `verdict` leaving an ambiguous answer at 125; edited steps that start a background command and kill it from their own `EXIT` trap still exiting 0 for `n` and 1 for `y`, with `exit=` as the last line; and a syntax error in the edited steps exiting with a status that is neither 0 nor 1.
10. Editorial: wording condensed and rephrased in Grupo Ilao's words throughout.

## Approval

Internal reuse under the MIT license is approved through review of the pull request that introduces it.
