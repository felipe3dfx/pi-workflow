# Child-session delegation

Status: IMPLEMENTED (#63–#74, parent #77)

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
- As the operator, I can manage model profiles from the TUI and choose which one is active.
- As the operator, I am warned, not surprised, when a launch is refused or a companion is missing.

## Implementation decisions

### Delegation

Jev answers whether the work should leave the session. It stays for architecture, an unresolved user decision, or a conflict between agents. If Jev does not answer, the work stays and the operator is warned. No child is launched.

The parent names `explore`, `worker`, or `verify` with the task; Jev does not name the role. Role, contract, model profiles, worktree, and the selected model are checked before Jev is asked. A missing role uses `worker` and warns. An unknown role is a refusal. The known set is those three names, whether or not the contract file can be read. A missing or unreadable contract is a refusal, not `worker`.

The parent passes only the role name and the task. The file in `assets/contracts/` owns the prompt and tools. Those files are harness child contracts, not engineering skills.

### Model selection

There is no named-model precedence. The launcher selects one pair and runs that pair. A mismatch is when the child would run a different model or thinking than the selected pair. Then the child does not start and the work stays pending.

The child's role selects a specialist of the active model profile: `explore` selects `explorer`, `worker` selects `worker`, and `verify` selects `verifier`. Jev does not classify the task and does not choose a model.

Order:

1. Role: an unknown role is a refusal; a missing role uses `worker` and warns.
2. Contract: a missing or unreadable contract is a refusal.
3. Model profiles: an invalid or unreadable file, including a schema v1 file, is a refusal. A missing file is not.
4. Worktree: an invalid worktree is a refusal.
5. Model: with no file, or when the active profile has no entry for the specialist, the child inherits the session model and thinking. If the session has neither, the launch is refused. Otherwise the entry is the pair. A model Pi does not have, or a thinking level the model does not support, is a refusal that names the profile, the specialist, and the setting. There is no fallback to another model.
6. Jev: asked last whether the work stays or leaves. If the work stays, or Jev does not answer, do not launch.

### Configuration

One global file, `pi-workflow-models.json` in the Pi agent directory, holds the model profiles: `{schemaVersion: 2, active, profiles: {slug: {explorer, worker, verifier}}}`, where each specialist entry is `{model, thinking}`. Profile slugs match `[a-z0-9-]{1,64}`. Any specialist entry may be omitted and then inherits the session model.

`/workflow:models` opens a modal panel. It creates, duplicates, renames, deletes, and activates profiles, and picks a model and thinking level for each specialist. Models come from Pi's catalog of available models, and thinking is limited to the levels each model supports. A save writes the file and applies immediately, without `/reload`. A schema v1 file is refused; there is no migration.

Jev does not decide quota failover, workflow authorization, result correctness, or which of two agents is right. It does not answer risk, complexity, capability, or deep-reasoning questions. There is no consult tool.

### Launch and session shape

If the session can receive a later result, the child starts in the background. There is no separate switch. Print mode runs in the foreground and rejects background, questions, and overlay. The result of a foreground child returns in the same call.

Working states are queued, running, and waiting for a reply. Terminal states are completed, failed, cancelled, and timed out. Cancel from the model and stop from the TUI reach cancelled. `continue` starts a new child from the saved conversation of a completed child. The completed record stays terminal. The new child has its own id and starts queued. Failed, cancelled, and timed-out children are not continued.

At most five children run at once, counting running and waiting children. The rest stay queued and start first in, first out. A child with no activity for four minutes, or thirty minutes while a tool is still running, is timed out; time spent queued does not count, and a foreground call then fails as timed out.

A child may ask the parent one question at a time. Each question is numbered and the child waits for a reply. The parent model answers with `reply_child`, naming the child and the question number. A reply to a question that is not waiting, or to a child that has ended, is refused and never answers another question. A question has no expiry of its own: it ends with its reply, a cancel, the end of the session, or the stall watchdog, which leaves the child timed out. A foreground child's question fails at once.

The model lists children and reads one child's state or final result with `list_children`, `child_status`, and `child_result`, and cancels with `cancel_child`. The operator lists and cancels them from the children view. Every terminal state delivers one message naming the state, except a cancel the model requested, whose tool result is the delivery. `continue_child` takes a follow-up task, reuses the completed child's contract, model, and thinking without asking Jev again, and may be repeated on the same completed record. Child records and completed conversations are kept until the session ends. A child that finishes between the parent's abort and the session's shutdown is delivered to the outgoing session only.

A refusal is a result with no child id, a warning, and a reason. It is not a child state. An invalid worktree is rejected before launch. Any real, existing Git root is accepted, not only the session's repository. `GIT_DIR` and `GIT_WORK_TREE` are ignored when the root is checked. The harness does not create or clean up worktrees. It only selects an existing root.

The launcher lives behind the extension adapter. The extension registers the tool. It does not own selection policy.

### Operator surfaces

The operator sees the children of the current session in a Pi widget pinned just above the input, above the task box, so it stays in view and redraws only its own lines. It keeps the approved header design: it reads `Subagents` and the count, an empty list is omitted, and each row shows the name, the current step, the model, the effort, and the elapsed time, with the active row highlighted. It refreshes at once on a state change and once per second only while a child is working, with redraws grouped at most every 400 ms. Finished rows stay visible for 60 seconds, at most three of them, and the box shows up to eight rows plus `… N more`. Effort also appears on the session input through Pi's footer.

Because the widget cannot receive keys, `alt+a` or `/workflow:subagents` opens a full-screen children view on demand. In it, `j`/`k` move the active row, `Enter` opens that child's live detail, `s` or `c` cancels it after a confirmation (a queued child is cancelled without one), `Esc` goes back from the detail, and `q` closes the view. Every state can be opened, cancelled included. Thinking in the detail can be collapsed with Pi's thinking toggle. A click works inside the view in fullscreen, and every click also has a key, because regular mode leaves the mouse to the terminal. Child content shown in the box, the view, and the detail is stripped of terminal control sequences. The view closes when a non-overlay, such as the question panel, takes focus.

Session tasks are not children. The box does not share the subagent list's header; it is a Pi widget pinned just above the input, so it stays in view once earlier turns scroll the transcript. The box only appears while tasks exist. The list sits in a box with bracket corners outside the text column, space above and below. Because the widget cannot receive keys, `alt+shift+t` collapses or expands the box and `alt+shift+h` shows or hides done tasks. A pending row is highlighted. A done row uses a green check. The list is rebuilt, without reading any file, from the last successful `todo` result's details on session start and on tree navigation. A session that ends with every task done starts its next list empty. The tool can write the whole list, add one task, update one task, clear the list, or list it. It does not create a feature document.

A question panel replaces the input. The transcript stays above it. The header says how many questions are waiting, plus the elapsed time and the token count. Options are numbered, with a marker and a description on the right. The active option is highlighted across the row. In browse mode, ↑/↓ move the active row and Enter answers it; digits jump straight to an option. Tab no longer moves between rows. `z` enters the free-text row and switches to edit mode, where every key, including a leading `x` or `X`, is typed as text. Esc leaves edit mode back to browse; in browse mode it leaves the question panel open and is not a refusal. `Shift+X` dismisses the panel outside edit mode; the asking tool then receives a refusal and does not invent an answer. `ask_user_question` has no options and opens straight in edit mode. `ask_user_choice` with `multiple: true` shows checkboxes instead of a single marker; Space toggles the active option, and Enter submits the marked options once at least one is marked, with any typed free text carried as an extra. Answering does not launch a child. An aborted turn closes the panel with a refusal. Ask-user tools run one at a time. Print mode refuses the panel the same way.

A closed tool is one line. Opening it shows the body under that title. A thick left bar encloses both the title and the body. Pi's global expand toggle opens and closes it. Opening it does not change the file or the tool result. Thinking keeps Pi's native one-line collapse.

`pi-pretty` is not an expected companion. If it is installed, status and doctor warn that it registers the same tool names and name the external removal command. The harness does not uninstall it. The harness does not copy gentle-shell thinking-label patches.

### Companions and CodeGraph

One catalog edit removes `@tintinweb/pi-subagents` and `@vndv/pi-codegraph`. Status and doctor follow that file. They do not special-case CodeGraph as a companion. Nothing is installed or uninstalled silently.

If `@tintinweb/pi-subagents` is still installed, spawn tools are not registered. Status, doctor, and `/workflow:setup` remain. The warning names the external removal command and the harness does not run it.

The `codegraph` tool copies the gentle-shell contract: `init`, `query`, and `explore` on the current Git root only. No other path and no shell command. A missing index may be created by `init`. A symlink or non-directory index is rejected. A workspace that is not the real Git root is a tool error and the command does not run. `GIT_DIR` and `GIT_WORK_TREE` are ignored when the root is checked and when the binary runs. A missing binary is unavailable and tells the caller to use `read`, `grep`, and `find`. Other run failures are failed, with the same fallback. `init` is a tool operation, not a human confirmation and not startup.

## Testing decisions

Tests cross the launcher interface and the extension adapter, not private helpers.

- Stay, missing Jev answer, unknown role, missing contract, invalid or v1 profiles file, and invalid worktree produce a refusal and no child id.
- The role selects its specialist in the active profile. A missing entry inherits the session model and thinking.
- An unavailable model or an unsupported thinking level refuses the launch before Jev is asked.
- Jev's stay or leave verdict runs after the local checks.
- A session that can receive a later result starts the child in the background. Print mode rejects background and returns the foreground result in the same call.
- Status and doctor follow the edited catalog and do not treat a missing CodeGraph index as a missing companion.
- Packed distribution includes `assets/contracts/` and still rejects `skills/`, `prompts/`, and `assets/agents/`.
- The pinned subagent box shows a background child, and the session task list sits in a widget above the input. `alt+a` opens the children view with the live detail. Print mode refuses the question panel and does not invent an answer.
- `todo` changes only the session task list. It does not create a feature document. A closed tool is one line. Opening it does not change the file.

## Out of scope

ODD, RDD, SDD, remediation, inter-session messaging, shell chrome, runtime metrics, skill registry, startup banner, budget, prompt-cache switching, parent model changes, Laya, skill-gate packs, and a consult tool.

## Prototype

`prototype/child-session-operator/`. Disposition: reference-only. It is evidence, not an implementation base.

## Approved deviations

Harness-owned child session and CodeGraph access are authorized by ADR 0005. The catalog edit in this feature is the later code change that ADR 0005 names. No silent uninstall.

## Accepted risks

- A worktree may be any real Git root on the disk, not only the session's repository (#64).
- A child that finishes between the parent's abort and the session's shutdown delivers its result to the outgoing session only (#68).

## Dependencies

Pi child sessions, Jev, the Pi model catalog, and the `/workflow:setup` command. Engineering skills stay unowned.

## Feature review

Final verdict: `READY WITH WARNINGS`. Handoff: `present (root-selected)`, `CONTEXT.md`, ADR 0005 accepted. The user accepted the four warnings in the review report.

Report: `docs/specs/child-session-delegation-review.md`.
