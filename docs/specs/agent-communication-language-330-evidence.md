# #330 implementation evidence

## Scope and environment

- Ticket: #330, "Mantener el inglés entre padre e hijos y el idioma del usuario con el orquestador"; branch `330`, based on `328`.
- Specification: `docs/specs/agent-communication-language.md`, sections "Observable contract", "Implementation decisions" and "Testing decisions"; decisions D1, D2, D4, D5, T1 and T2.
- Host: macOS (Darwin 27.2.0), Node v22.21.1. Installed Pi 1.5.2 at `~/bin/pi`; the repository's SDK dependency is Pi 1.5.0 (`package-lock.json`).

## What changed

- `extensions/pi-workflow.ts`: a `before_agent_start` handler sets one private structured section, `pi-workflow-language`, on `systemPromptOptions.sections` for every run, independent of the Delegation mode, Jev routing and the child tools offered. It carries rules 1, 3, 4 and 5 and the non-modification of operator Fleet messages (rule 6). The Delegation mode seam (`context_with_system`, `pi-workflow-delegation-mode`) and its conditions are unchanged. No tool description, guideline, option or configuration value changed.
- `assets/contracts/{explore,worker,verify,contextual}.md`: each Contract carries rules 2 and 5: questions, findings, reports, Verdict reasons and change and validation descriptions for the parent are English whatever the task, user or operator language; transported content keeps its content or required language; keys, enums and identifiers are never translated.
- `test/child-contracts.test.mjs`: the test that asserted the local `AGENTS.md` sentence now asserts the packaged coverage in all four Contracts (D2). `AGENTS.md` is unchanged.
- `test/delegation-mode.test.mjs`: the real-SDK parent setup is a shared helper; new tests observe faux-provider requests.
- `test/rpc-child-pi.test.mjs`: a new real-binary test launches every packaged Contract through `createChildLauncher().prepareLaunch` and a continued child, and reads the system prompt the `fake/echo` endpoint receives.

## Deterministic instruction delivery

Expected values come from the specification's rules, not from the instruction text. RED was recorded with the handler disabled and the Contracts at their base text.

| Obligation | Test | RED (before) | GREEN (after) |
| --- | --- | --- | --- |
| Parent rules 1, 3–6 on the model call | `delegation-mode.test.mjs` "the language instruction keeps parent-child text English, ..." | `the model call carries no language instruction` | pass |
| Parent: `opportunistic`/`orchestrator` × Jev routing off/on × child tools offered/not offered, every model call of two prompts, Delegation mode section present only in `orchestrator` with child tools | 8 tests "in <mode> with Jev routing <on/off> and the child tools <offered/not offered>, ..." | 8 × `the model call carries no language instruction` | 8 pass |
| Parent: every model call of a run started by a delivered child result, both modes | 2 tests "in <mode>, every model call of a run a child result starts ..." | 2 × `the model call carries no language instruction` | 2 pass |
| Delegation mode regressions (unchanged) | existing `context_with_system` tests, "in a real Pi session, the run that a child result starts carries the instruction" | pass | pass |
| Packaged Contract coverage replaces the local `AGENTS.md` premise | `child-contracts.test.mjs` "every packaged contract keeps text for the parent in English ..." | `no sentence matches all of ...` | pass |
| Effective system prompt of real Pi children, `explore`, `worker`, `verify` and the contextual variant (authorization route), launched and continued | `rpc-child-pi.test.mjs` "a real Pi child of every packaged contract, launched and continued, ..." | 4 subtests: `The input did not match the regular expression /\bfor the parent in English\b.../` on the launched child's prompt | 4 subtests pass; both the launch and the continuation request carry the rule |
| Reply, Steer, questions, consultations and results surfaces | existing child-session, RPC child and contextual-authorization suites, unchanged expectations | pass, except the host failures below | same: the in-process registry, Steer, question, consultation and result suites pass; the SDK-parent RPC consultation/reply tests and the guarded-bash worker report test are among the 11 host failures before and after, so they are unverified on this host |

Continuation: a continued child resumes from its stored launch plan (`child-sessions.ts`, `{ ...child.plan, task }`), and the plan of a child launched after this change carries the new Contract; the real-binary test observes it in the continued child's own request. Continuation semantics are unchanged. A child launched before this change keeps its old plan when continued in the same parent process.

The real-binary tests ran against a Pi 1.5.0 on PATH (a shim to the repository's `node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js`), because `rpc-child.ts` refuses a child whose Pi differs from the parent SDK's version and the installed Pi is 1.5.2. With the installed 1.5.2 first on PATH, the new test and the existing "a background child runs as a real Pi process ..." test (the two tried) fail at launch with that refusal.

Instruction presence proves delivery only, not compliance.

## Quality gate

`npm run check` on this host, with the Pi 1.5.0 shim first on PATH: biome, typecheck, knip, focused-tests, publish and release stages pass; `node --test test/*.test.mjs` reports tests 1575, pass 1561, fail 11, skipped 3, so the chain stops before `check:distribution`, which passes when run alone (`Packed distribution validation passed.`).

The 11 failures are the same tests that fail on the base `328` (`13d5130`) on this host with the same PATH (tests 1558, pass 1544, fail 11, skipped 3): a bash syntax-error line number, a `/private/var` versus `/var` temporary path, the installed Claude Bridge package, three SDK-parent RPC consultation tests, the sandbox dry-run, the guarded-bash worker, two RPC launch-argv tests and the missing pi-web-access package. None touches the changed files; the 17 tests this change adds pass. The gate is therefore not green on this macOS host for pre-existing environmental reasons, and CI evidence is still required.

CI `npm run check` passed on PR #340 for head `80fcb0c`: https://github.com/felipe3dfx/pi-workflow/actions/runs/42865780809/job/130003598564 (the run is for that head, before the review fixes that follow it).

## Behavioral QA

Reported separately from instruction delivery. One ordinary real Pi session, driven non-interactively over `--mode rpc`.

- Pi 1.5.2 (`~/bin/pi`), loading this branch's `extensions/pi-workflow.ts` with `--no-extensions --extension builtin:mcp`; package `@felipe.3dfx/pi-workflow` 3.1.0 at this branch.
- Isolated agent directory: the operator's authentication and model store linked in, no `APPEND_SYSTEM.md`, no other packages; operator questions and CodeGraph unseated.
- Parent model `openai/gpt-6.1-terra` (thinking default); model profile `default` (explorer `openai/gpt-6.1-terra` medium, worker `openai/gpt-6.1-terra` high).
- Delegation mode `opportunistic`, Jev routing off, role-contract (non-contextual) variant.
- Consumer project: a fresh Git repository whose `AGENTS.md` has no language rule.
- Parent session: `2026-11-10T16-58-02-266Z_01a1c665-2e9a-744b-b311-7b4b65adaddb.jsonl` (records the `pi-workflow-language` section). The raw session files were in a temporary directory and are not kept; [`agent-communication-language-330-evidence/transcript.json`](agent-communication-language-330-evidence/transcript.json) is the extract of that session (user turns, parent text, parent tool calls to children, child questions and results, and the delivered language section), and [`ticket-changelog.md`](agent-communication-language-330-evidence/ticket-changelog.md) is the delivered draft. Children: worker `ed608b74-dfd7-43de-aaf4-61b614ae1533`, its continuation `c5915991-9550-4a2a-b4ea-4a5813bfdfca`, explorer `3566a50e-61c1-4424-a98c-daa102144a1f`. The child session transcripts were not kept; delivery of the Contract language rule to a real Pi child is evidenced by the deterministic `test/rpc-child-pi.test.mjs` test, not by these sessions.

| # | Turn and observation | Result |
| --- | --- | --- |
| S1 | Spanish request to delegate a worker; `spawn_child` task: "Create docs/ticket-changelog.md with a Spanish draft ticket ... you must ask the parent whether the draft should include acceptance criteria ...". Spanish decision "Sí, incluye tres criterios de aceptación y usa un tono formal." → `reply_child` answer "Yes. Include exactly three acceptance criteria and use a formal tone." "Continúa ese mismo hijo ..." → `continue_child` task "Continue your previous task: add a risks section in Spanish ..." | pass |
| S2 | Child question: "Should the Spanish draft ticket include acceptance criteria? Please choose: (A) yes, include them; (B) no, omit them." Parent to the user: "¿Debe incluir el borrador del ticket criterios de aceptación? A) Sí, incluirlos. B) No, omitirlos." | pass |
| S3 | Child results: "Verdict: done. files_changed: docs/ticket-changelog.md — added a formal Spanish draft ticket with exactly three acceptance criteria. validation: ..." and "... added a Spanish risks section; preserved the existing acceptance criteria." Parent to the user: "El hijo creó `docs/ticket-changelog.md` con un borrador formal en español ..." | pass |
| S4 | The draft was delivered as a file, not inline: `docs/ticket-changelog.md` is Spanish ("# Ticket: incorporar un archivo CHANGELOG.md", "## Criterios de aceptación", "## Riesgos"). The accompanying reports, validation and left_undone are English, and they quote the Spanish criteria verbatim | pass |
| S5 | "From now on, please talk to me in English. Ask a new explore child ..." → `spawn_child` task "List the files and directories in the repository root ..."; parent to the user in English: "The repository root contains: ..."; child result English | pass |
| S6 | Operator Steer or Fleet view answer in Spanish | BLOCKED: the Fleet view is an interactive overlay with no non-interactive path in this run. Deterministic coverage only: the existing Steer and Fleet answer tests pass with unchanged expectations, and the Contracts state that an operator message does not change the reporting language |

One session with one model is not evidence of universal compliance. S7 (consultation reply free text) and the `orchestrator` and contextual variants (S8) were not exercised in real sessions; their delivery is covered by the deterministic tests above.
