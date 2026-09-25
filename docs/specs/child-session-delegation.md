# Child-session delegation

Status: PUBLISHED

Package: delegation brief confirmed in the originating session.
Review handoff: `origin/main` `0e460e0`, ADR 0005 accepted.
Verdict: `READY`.

## Problem

The operator talks to one parent Pi session. Work that is bounded enough to leave that session must run as a child session, with a selected model and thinking level, without changing the parent session and without the parent model inventing the child contract.

## Solution

The harness extension remains the adapter. A child-session launcher module behind that adapter decides whether to launch, which contract to use, and which model and thinking pair to run. Jev answers closed questions. Code composes the launch. The parent passes only a role name and a task.

## User stories

- As the operator, I stay on the current session model while a child does bounded work.
- As the operator, I see running children and can stop them from the TUI.
- As the operator, I can edit the model lists from the TUI, or let a command create them once.
- As the operator, I am warned, not surprised, when a launch is refused or a companion is missing.

## Implementation decisions

### Delegation

Jev answers whether the work should leave the session. It stays for architecture, an unresolved user decision, or a conflict between agents. If Jev does not answer, the work stays and the operator is warned. No child is launched.

If it leaves, Jev names `explore`, `worker`, or `verify`. A missing role uses `worker` and warns. An unknown role is a refusal. The known set is those three names, whether or not the contract file can be read. A missing or unreadable contract is a refusal, not `worker`.

The parent passes only the role name and the task. The file in `assets/contracts/` owns the prompt and tools. Those files are harness child contracts, not engineering skills. Task types do not invoke engineering skills.

### Model selection

There is no named-model precedence. The launcher selects one pair and runs that pair. A list walk is selection, not a mismatch. A mismatch is when the child would run a different model or thinking than the selected pair. Then the child does not start and the work stays pending.

Order:

1. If the work stays, do not launch.
2. If the task type is uncertain or unknown, do not walk lists. Use the session model and thinking, and warn.
3. Otherwise the task type selects the specialist list of that name and, through the saved map, which tier list to walk. The map does not rewrite list contents at launch. The role does not select a model list.
4. Walk defined lists only. An empty list is undefined. If only one selected list is defined, walk that list. Do not use the session model for that case.
5. If the type is known and both selected lists are undefined, use the session model and thinking.
6. Unavailable means Pi does not have the model, or it cannot run at the selected thinking. If every defined entry is unavailable, the work stays pending. Do not drop to another tier.

Tiers are only `quick`, `standard`, and `high`. There is no premium tier and no forced tier. The creation map is initial file content: `chat`, `explain`, and `write` name `quick`; `operate`, `implement`, `debug`, `refactor`, and `research` name `standard`; `plan` and `review` name `high`.

### Configuration

One global file holds specialist lists, tier lists, and the task-type map. The command and the TUI write that same file. The TUI editor is a panel navigated by sections: specialists, tiers, and the task-type map. Models are picked from Pi's catalog of available models, and thinking is limited to the levels each model supports. After adding a model, the editor stays in the catalog to add another. Saving replaces the file only when it already existed; otherwise it creates the file without overwriting one that appeared meanwhile. Unsaved changes ask to confirm discarding before exit. The command creates the file only when missing. Replacement requires confirmation. Print mode does not replace an existing file. It only warns. If the file is missing, print mode may create it. A file created in the current turn is not read and is not a refusal. It applies only after `/reload`. An invalid or unreadable file is a refusal.

The command researches each model from Pi's catalog metadata: name, reasoning, context window, maximum output, input modalities, cost per million tokens, and supported thinking levels. The tier follows cost relative to the available catalog, not Jev: models with a cost are sorted by output cost, input cost breaking ties, and the first third goes to `quick`, the middle third to `standard`, and the last third to `high`. Models with the same cost share a tier, and the split is fixed before Jev is asked, so a model left out does not move the others. A model whose catalog cost is 0 gets no tier list, joins only its specialist list, and is reported. Jev picks each model's thinking level for its tier (`quick` for mechanical work, transcription, and cheap sweeps; `standard` for exploration, implementation, and tests; `high` for coordination, review, and risk) among the levels the model supports. Jev classifies each model by task type, not by intelligence or speed. Context capacity affects only specialist placement. The command assigns one task type, which places the model only in that specialist list. The TUI can add the model to other specialist lists. The map only names which tier a task type walks at launch. If either question fails, the model is left out and the others are saved. NaN may appear in any list if the user or the command places it. There is no hardcoded long-context model.

Jev does not decide quota failover, workflow authorization, result correctness, or which of two agents is right. It does not answer risk, complexity, capability, or deep-reasoning questions. There is no consult tool.

### Launch and session shape

If the session can receive a later result, the child starts in the background. There is no separate switch. Print mode runs in the foreground and rejects background, questions, and overlay. The result of a foreground child returns in the same call.

Working states are queued, running, and waiting for a reply. Terminal states are completed, failed, cancelled, and timed out. Cancel from the model and stop from the TUI reach cancelled. `continue` starts a new child from the saved conversation of a completed child. The completed record stays terminal. The new child has its own id and starts queued. Failed, cancelled, and timed-out children are not continued.

A refusal is a result with no child id, a warning, and a reason. It is not a child state. An invalid worktree is rejected before launch. The harness does not create or clean up worktrees. It only selects an existing root.

The launcher lives behind the extension adapter. The extension registers the tool. It does not own selection policy.

### Operator surfaces

The operator sees the children of the current session in Pi's header, above the chat. The lists are not transcript lines. Pi uses `setHeader`. That placement is not a proven scroll pin. The header reads `Subagents` and the count. An empty list is omitted. Each row shows the name, the current step, the model, the effort, and the elapsed time. The active row is highlighted. Effort also appears on the session input.

`[↗]` opens that child's detail inside the TUI. Thinking in that detail can be collapsed. `[x]` on the list cancels that child. A cancelled child stays visible without `[↗]`. In the detail, `[x]` closes the viewer and does not cancel. `Ctrl+x` cancels the child. `q` or `Esc` also closes the detail. A click works in fullscreen. Every click also has a key, because regular mode leaves the mouse to the terminal.

Session tasks are not children. The box does not share the subagent list's header; it is a Pi widget pinned just above the input, so it stays in view once earlier turns scroll the transcript. The box only appears while tasks exist. The list sits in a box with bracket corners outside the text column, space above and below. Because the widget cannot receive keys, `alt+shift+t` collapses or expands the box and `alt+shift+h` shows or hides done tasks. A pending row is highlighted. A done row uses a green check. The list is rebuilt, without reading any file, from the last successful `todo` result's details on session start and on tree navigation. A session that ends with every task done starts its next list empty. The line near the input counts running children, not tasks. The tool can write the whole list, add one task, update one task, clear the list, or list it. It does not create a feature document.

A question panel replaces the input. The transcript stays above it. The header says how many questions are waiting, plus the elapsed time and the token count. Options are numbered, with a marker and a description on the right. The active option is highlighted across the row. In browse mode, ↑/↓ move the active row and Enter answers it; digits jump straight to an option. Tab no longer moves between rows. `z` enters the free-text row and switches to edit mode, where every key, including a leading `x` or `X`, is typed as text. Esc leaves edit mode back to browse; in browse mode it leaves the question panel open and is not a refusal. `Shift+X` dismisses the panel outside edit mode; the asking tool then receives a refusal and does not invent an answer. `ask_user_question` has no options and opens straight in edit mode. `ask_user_choice` with `multiple: true` shows checkboxes instead of a single marker; Space toggles the active option, and Enter submits the marked options once at least one is marked, with any typed free text carried as an extra. Answering does not launch a child. An aborted turn closes the panel with a refusal. Ask-user tools run one at a time. Print mode refuses the panel the same way.

A closed tool is one line. Opening it shows the body under that title. A thick left bar encloses both the title and the body. Pi's global expand toggle opens and closes it. Opening it does not change the file or the tool result. Thinking keeps Pi's native one-line collapse.

`pi-pretty` is not an expected companion. If it is installed, status and doctor warn that it registers the same tool names and name the external removal command. The harness does not uninstall it. The harness does not copy gentle-shell thinking-label patches.

### Companions and CodeGraph

One catalog edit removes `@tintinweb/pi-subagents` and `@vndv/pi-codegraph`. Status and doctor follow that file. They do not special-case CodeGraph as a companion. Nothing is installed or uninstalled silently.

If `@tintinweb/pi-subagents` is still installed, spawn tools are not registered. Status, doctor, and explicit companion install remain. The warning names the external removal command and the harness does not run it.

The `codegraph` tool copies the gentle-shell contract: `init`, `query`, and `explore` on the current Git root only. No other path and no shell command. A missing index may be created by `init`. A symlink or non-directory index is rejected. A workspace that is not the real Git root is a tool error and the command does not run. A missing binary is unavailable and tells the caller to use `read`, `grep`, and `find`. Other run failures are failed, with the same fallback. `init` is a tool operation, not a human confirmation and not startup.

## Testing decisions

Tests cross the launcher interface and the extension adapter, not private helpers.

- Stay, missing Jev answer, unknown role, missing contract, invalid file, and invalid worktree produce a refusal and no child id.
- A known type with one defined list walks that list and does not use the session model.
- An uncertain type uses the session model even when lists exist.
- An unavailable selected pair does not start.
- A session that can receive a later result starts the child in the background. Print mode rejects background and returns the foreground result in the same call.
- A same-turn config file is not read. An invalid file is a refusal.
- Status and doctor follow the edited catalog and do not treat a missing CodeGraph index as a missing companion.
- Packed distribution includes `assets/contracts/` and still rejects `skills/`, `prompts/`, and `assets/agents/`.
- The header shows a background child, and the session task list sits in a widget above the input. `[↗]` opens the in-TUI detail. Print mode refuses the question panel and does not invent an answer.
- `todo` changes only the session task list. It does not create a feature document. A closed tool is one line. Opening it does not change the file.

## Out of scope

ODD, RDD, SDD, remediation, inter-session messaging, shell chrome, runtime metrics, skill registry, startup banner, budget, prompt-cache switching, parent model changes, Laya, skill-gate packs, and a consult tool.

## Prototype

`prototype/child-session-operator/`. Disposition: reference-only. It is evidence, not an implementation base.

## Approved deviations

Harness-owned child session and CodeGraph access are authorized by ADR 0005. The catalog edit in this feature is the later code change that ADR 0005 names. No silent uninstall.

## Accepted risks

None identified by the final feature-review.

## Dependencies

Pi child sessions, Jev, the Pi model catalog, and the existing companion install command. Engineering skills stay unowned.

## Feature review

Final verdict: `READY WITH WARNINGS`. Handoff: `present (root-selected)`, `CONTEXT.md`, ADR 0005 accepted. The user accepted the four warnings in the review report.

Report: `docs/specs/child-session-delegation-review.md`.
