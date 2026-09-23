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

One global file holds specialist lists, tier lists, and the task-type map. The command and the TUI write that same file. The command creates it only when missing. Replacement requires confirmation. Print mode does not replace an existing file. It only warns. If the file is missing, print mode may create it. A file created in the current turn is not read and is not a refusal. It applies only after `/reload`. An invalid or unreadable file is a refusal.

The command researches locally and on the internet. Jev classifies each model by task type, not by intelligence or speed. Context capacity affects only specialist placement. The command assigns one task type. The TUI can add the model to other specialist lists. The map fills the tier list at creation. NaN may appear in any list if the user or the command places it. There is no hardcoded long-context model.

Jev does not decide quota failover, workflow authorization, result correctness, or which of two agents is right. It does not answer risk, complexity, capability, or deep-reasoning questions. There is no consult tool.

### Launch and session shape

If the session can receive a later result, the child starts in the background. There is no separate switch. Print mode runs in the foreground and rejects background, questions, and overlay. The result of a foreground child returns in the same call.

Working states are queued, running, and waiting for a reply. Terminal states are completed, failed, cancelled, and timed out. Cancel from the model and stop from the TUI reach cancelled. `continue` starts a new child from the saved conversation of a completed child. The completed record stays terminal. The new child has its own id and starts queued. Failed, cancelled, and timed-out children are not continued.

A refusal is a result with no child id, a warning, and a reason. It is not a child state. An invalid worktree is rejected before launch. The harness does not create or clean up worktrees. It only selects an existing root.

The launcher lives behind the extension adapter. The extension registers the tool. It does not own selection policy.

### Operator surfaces

The operator can see the children of the current session on a card above the editor. Each row shows the agent, the task label, the model, and the elapsed time. The current step is shown only while the child is waiting for a reply. Choosing a child from the overlay writes a markdown transcript and opens it in `$EDITOR`. It is not a live conversation inside the TUI. Print mode does not open the overlay.

A `todo` tool and its card keep the session task list. The tool can write the whole list, add one task, update one task, clear the list, or list it. This is not an ODD feature document, an Engram mirror, or a review trigger.

`ask_user_choice` asks one question with two to four closed options. `ask_user_question` asks a validated questionnaire. Both are refused in print mode, with a warning and no invented answer. They do not launch a child.

The harness renders `read`, `bash`, `grep`, `find`, `ls`, `edit`, and `write` in a compact form. This does not change what those tools do.

`pi-pretty` remains an expected companion. If it is missing, the harness is degraded and nothing is installed. The harness does not copy gentle-shell thinking-label patches.

### Companions and CodeGraph

One catalog edit removes `@tintinweb/pi-subagents` and `@vndv/pi-codegraph`, and adds `@heyhuynhgiabuu/pi-pretty`. Status and doctor follow that file. They do not special-case CodeGraph as a companion. A missing `pi-pretty` install is a degraded harness. Nothing is installed or uninstalled silently.

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
- The card shows a background child. The overlay opens its transcript in `$EDITOR`. Print mode refuses the overlay and both question tools.
- `todo` changes only the session task list. It does not create a feature document.

## Out of scope

ODD, RDD, SDD, remediation, inter-session messaging, shell chrome, runtime metrics, skill registry, startup banner, budget, prompt-cache switching, parent model changes, Laya, skill-gate packs, and a consult tool.

## Prototype

None. Disposition: not required. Functional questions were resolved by reading gentle-shell and the referent router, then confirmed in the brief.

## Approved deviations

Harness-owned child session and CodeGraph access are authorized by ADR 0005. The catalog edit in this feature is the later code change that ADR 0005 names. No silent uninstall.

## Accepted risks

None identified by the final feature-review.

## Dependencies

Pi child sessions, Jev, the Pi model catalog, and the existing companion install command. Engineering skills stay unowned.

## Feature review

Final verdict: `READY`. Handoff: `origin/main` `0e460e0`, ADR 0005 accepted. Focused background review: `READY`. No undisposed warning.

Report: `docs/specs/child-session-delegation-review.md`.
