# Child-session delegation

Status: IMPLEMENTED (#63–#74, parent #77)

Package: delegation brief confirmed in the originating session.
Review handoff: `origin/main` `0e460e0`, ADR 0005 accepted.
Verdict: `READY`.

## Problem

The operator talks to one parent Pi session. Work that is bounded enough to leave that session must run as a child session, with a selected model and thinking level, without changing the parent session and without the parent model inventing the child contract.

## Solution

The harness extension remains the adapter. A child-session launcher module behind that adapter decides whether to launch, which contract to use, and which model and thinking pair to run. Jev answers closed questions. Code composes the launch. The parent passes a task and may pass a role suggestion.

## User stories

- As the operator, I stay on the current session model while a child does bounded work.
- As the operator, I see running children and can stop them from the TUI.
- As the operator, I can manage model profiles from the TUI and choose which one is active.
- As the operator, I am warned, not surprised, when a launch is refused or a companion is missing.

## Implementation decisions

### Delegation

Three decisions stay separate. This change covers destination (parent or child) and specialist (`explorer`, `worker`, or `verifier`). Model and thinking still come from the active profile entry for the chosen specialist. Dynamic model routing, confidence thresholds, and a Jev-verified model cascade are later work.

The harness copies the latest user message. A named engineering skill in that message selects the destination and specialist in code, and Jev is not called. `feature-review`, `code-review`, `review-critique`, `promotion-readiness`, and `mutation-testing` leave as `verify`. `simplify`, `scope-audit`, and `qa-impact` leave as `explore`. `implement` and `tdd` leave as `worker`. `codebase-design`, `feature`, `domain-modeling`, `to-tickets`, and `create-pr` stay in the parent, including when the message also asks for a child. `prototype`, `to-spec`, `setup-workflow`, and `writing-for-agents` stay until the same message also shows approval (`aprobado`, `approved`, `publica`, `publish`, or `hazlo`); then they leave as `worker`. Longer skill names match first, and a hyphen is part of the name. The harness does not load the skill files. Explicit intent is detected from that message, not from the task string the parent wrote, when no skill route matches. An explicit request for a child, subagent, or delegation fixes the destination to child. Jev is not asked the destination in that case, so an architecture investigation cannot be vetoed for being architecture. Without explicit intent and without a skill route, one Jev call answers destination and specialist independently. `decide` means a product decision is still open. It blocks a gated parent tool, tells the parent to ask one question and wait, and does not launch. The warning is "Ask the user one question and wait". `stay` means the package is small and already understood. It keeps the work in the parent. On `spawn_child`, the warning is "The work stays in this session". `leave` selects the specialist. It blocks a gated parent tool instead of launching, and `spawn_child` launches that specialist. Investigating an architecture can leave. Choosing an architecture with the user is `decide`.

A missing key, a transport or parse failure, or a label outside the question's criteria blocks the launch and blocks a gated parent tool. The warning is "Launch blocked", distinct from "The work stays in this session". The harness does not invent `stay` and does not fill `worker`. The client keeps the choice, probabilities, confidence, the Jev model, and a request id when the payload has one. Policy does not branch on confidence. Jev returns no written rationale.

The parent may pass `explore`, `worker`, or `verify`. That role is a suggestion. A suggested role does not replace a verdict already stored for that user message. A missing role is not silently `worker` and does not warn that `worker` was assumed. An unknown role is a refusal before Jev when `spawn_child` asks. The known set is those three names, whether or not the contract file can be read. Jev selects `explorer`, `worker`, or `verifier` from the requested action and may override the suggestion. The harness maps that to the contract role `explore`, `worker`, or `verify`, then reads the contract and the active profile. A missing or unreadable contract is "Launch refused", not `worker`.

Invalid profiles file and invalid worktree still refuse the launch before Jev when `spawn_child` asks. When it reuses the turn's verdict, those checks still run and still refuse. The selected specialist's missing contract, unavailable model, or unsupported thinking refuses after Jev, because the specialist was not known earlier. Those remain "Launch refused".

Jev is consulted from `spawn_child` and from the parent's `tool_call` hook. Child sessions are started with extensions disabled, so the hook does not apply to them. One verdict is kept per user turn. `turn_start` drops it.

The hook does not ask Jev and does not block `spawn_child`, `continue_child`, `reply_child`, `cancel_child`, `list_children`, `child_status`, `child_result`, `ask_user_choice`, `ask_user_question`, or `todo`. It does not ask or block `codegraph` `init`. It does not ask or block a `read` of `AGENTS.md`, `CONTEXT.md`, or `docs/agents/<file>.md` when that path resolves inside the session cwd. Those reads are the only trivial exception. There is no file-count threshold.

`read`, `grep`, `find`, `ls`, `edit`, `write`, `bash`, `powershell`, and `codegraph` `query` or `explore` are gated. The first gated tool of the turn sends the latest user message as both the task and the user request. The hook adds no suggested role. If that turn has no user message, the tool runs and Jev is not asked. A skill route does not call Jev. An explicit request for a child, subagent, or delegation, or a `leave` answer, blocks the tool. The reason tells the parent to call `spawn_child` and names the role. `decide` blocks the tool, tells the parent to ask one question and wait, and does not say `spawn_child`. `stay` lets the tool run, and later gated tools in the turn do not ask again. A missing key, a transport or parse failure, or a label outside the criteria blocks the tool with "Launch blocked". The harness does not invent `stay`, `decide`, or `worker`. `spawn_child` in that same turn reuses the verdict for that user message, including a skill route. A suggested role on the call does not replace the cached role. Local launch checks still run. Confidence is kept and does not change the decision.

The parent passes the task and may pass a role suggestion. The file in `assets/contracts/` owns the prompt and tools. Those files are harness child contracts, not engineering skills. The worker prompt ends with `status`, `files_changed`, `validation`, and `left_undone`. `completed` is only for commands whose output is in the result. Explore, verify, and worker must not claim a command ran or a check passed unless that output is in the result. Verify also says what remained unverified. The parent does not declare the work finished without that worker block. The harness does not parse the block. `ask_parent` stays the only mid-run question channel.

### Model selection

There is no named-model precedence. The launcher selects one pair and runs that pair. A mismatch is when the child would run a different model or thinking than the selected pair. Then the child does not start and the work stays pending.

The child's role selects a specialist of the active model profile: `explore` selects `explorer`, `worker` selects `worker`, and `verify` selects `verifier`. Jev or a named skill selects that specialist and does not choose a model. The model and thinking check for that specialist runs after the specialist is known.

When `spawn_child` asks, the order is:

1. Role: an unknown role is a refusal before Jev. A missing role is not `worker` and does not warn.
2. Model profiles: an invalid or unreadable file, including a schema v1 file, is a refusal before Jev. A missing file is not.
3. Worktree: an invalid worktree is a refusal before Jev.
4. Skill route: a named engineering skill in the latest user message selects destination and specialist in code. Jev is not called. A parent-owned skill stays even when the message also asks for a child.
5. Explicit intent: when no skill route matches, the harness copies the latest user message and does not read intent from the task. An explicit request for a child, subagent, or delegation fixes the destination to child. Jev is not asked the destination.
6. Jev: selects `explorer`, `worker`, or `verifier` and may override the suggestion. Without explicit intent, one call answers destination and specialist independently. `decide` asks one question and does not launch. `stay` does not launch. `leave` launches the selected specialist. With explicit intent, Jev is not asked the destination. A missing key, a transport or parse failure, or a label outside the criteria blocks the launch. Do not invent `stay`, `decide`, or fill `worker`.
7. Contract: map the specialist to `explore`, `worker`, or `verify`. A missing or unreadable contract is "Launch refused", not `worker`.
8. Model: with no file, or when the active profile has no entry for the specialist, the child inherits the session model and thinking. If the session has neither, the launch is refused. Otherwise the entry is the pair. A model Pi does not have, or a thinking level the model does not support, is a refusal that names the profile, the specialist, and the setting. There is no fallback to another model.

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

If `@tintinweb/pi-subagents` is still installed, spawn tools are not registered. Status, doctor, and `/workflow:configure` remain. The warning names the external removal command and the harness does not run it.

The `codegraph` tool copies the gentle-shell contract: `init`, `query`, and `explore` on the current Git root only. No other path and no shell command. A missing index may be created by `init`. A symlink or non-directory index is rejected. A workspace that is not the real Git root is a tool error and the command does not run. `GIT_DIR` and `GIT_WORK_TREE` are ignored when the root is checked and when the binary runs. A missing binary is unavailable and tells the caller to use `read`, `grep`, and `find`. Other run failures are failed, with the same fallback. `init` is a tool operation, not a human confirmation and not startup.

## Testing decisions

Tests cross the launcher interface and the extension adapter, not private helpers.

- `decide` warns "Ask the user one question and wait", blocks gated tools, does not say `spawn_child`, and does not launch.
- `stay` warns "The work stays in this session" and does not launch. It lets gated tools run. It is not "Launch blocked" and it is not `decide`.
- A named engineering skill routes in code, does not call Jev, and beats an explicit child request when the skill stays in the parent.
- `/workflow:delegation-check` scores the fixed cases against Jev and does not launch a child. It is not part of `npm run check`. A missing TypeSafe key is a fail line.
- Child contract tests keep the worker return block and the ban on claiming a command or check that is not in the result. The harness does not parse that block.
- A missing key, a transport or parse failure, or a label outside the criteria warns "Launch blocked" and produces no child id. The harness does not invent `stay` or fill `worker`.
- An unknown role, an invalid or v1 profiles file, and an invalid worktree refuse the launch and produce no child id. They are refusals before Jev when `spawn_child` asks.
- A missing role is not `worker` and does not warn that `worker` was assumed.
- The selected specialist's missing contract, an unavailable model, or an unsupported thinking level is "Launch refused" after Jev.
- Without a skill route and without explicit intent, Jev answers destination and specialist before the contract and model checks. It is not asked last. Explicit intent fixes the destination to child and does not ask the destination. A skill route does not ask Jev.
- The role selects its specialist in the active profile. A missing entry inherits the session model and thinking.
- A session that can receive a later result starts the child in the background. Print mode rejects background and returns the foreground result in the same call.
- Status and doctor follow the edited catalog and do not treat a missing CodeGraph index as a missing companion.
- Packed distribution includes `assets/contracts/` and still rejects `skills/`, `prompts/`, and `assets/agents/`.
- The pinned subagent box shows a background child, and the session task list sits in a widget above the input. `alt+a` opens the children view with the live detail. Print mode refuses the question panel and does not invent an answer.
- `todo` changes only the session task list. It does not create a feature document. A closed tool is one line. Opening it does not change the file.

## Out of scope

ODD, RDD, SDD, remediation, inter-session messaging, shell chrome, runtime metrics, a skill registry, startup banner, budget, prompt-cache switching, parent model changes, Laya, skill-gate packs, and a consult tool. The harness matches a fixed list of engineering skill names. It does not load skill files.

## Prototype

`prototype/child-session-operator/`. Disposition: reference-only. It is evidence, not an implementation base.

## Approved deviations

Harness-owned child session and CodeGraph access are authorized by ADR 0005. The catalog edit in this feature is the later code change that ADR 0005 names. No silent uninstall.

## Accepted risks

- A worktree may be any real Git root on the disk, not only the session's repository (#64).
- A child that finishes between the parent's abort and the session's shutdown delivers its result to the outgoing session only (#68).

## Dependencies

Pi child sessions, Jev, the Pi model catalog, and the `/workflow:configure` command. Engineering skill files stay outside this package. The harness matches their names only.

## Feature review

Final verdict: `READY WITH WARNINGS`. Handoff: `present (root-selected)`, `CONTEXT.md`, ADR 0005 accepted. The user accepted the four warnings in the review report.

Report: `docs/specs/child-session-delegation-review.md`.
