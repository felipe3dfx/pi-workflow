# Routing owner

Status: IMPLEMENTED (#118, #119, #124, #125).

Package: the confirmed routing package after the renewed feature review.
Review handoff: ADR 0008 accepted on the merge of its introducing PR.
Verdict: READY WITH WARNINGS.

## Problem

The operator talks to one parent session. Routing can trap that session: gated tools stay blocked, the explore child has no shell, and a skill name can select a Specialist. The operator needs one owner for routing, and a persistent choice of whether that owner is Jev.

## Solution

Jev routing is one persistent choice. It is off until the operator turns it on. While it is off, the parent names the child role and Jev is not called. While it is on, Jev chooses whether the work stays or leaves and which Specialist launches. An engineering skill name never selects a Specialist.

The seam is the routing module behind the extension adapter. Callers see the stored choice, the `/workflow:config` menu row, and the launch result. They do not see where the choice is stored.

## User stories

- As the operator, I start with Jev routing off, and my choice remains until I change it.
- As the operator, I turn Jev routing on or off from a row of the `/workflow:config` menu.
- As the operator, I can run `git` and `gh` in the parent while routing is off.
- As the operator, I am not blocked because a skill name appeared in my message.

## Implementation decisions

### The choice

Jev routing is off until the operator turns it on. The choice persists until the operator changes it. Restarting Pi does not reset it. It is stored in the user's Pi configuration, in the same directory as the model profiles, in a separate document. It is not a field of the model profiles document. The TypeSafe key is not the switch.

A missing or unreadable choice document is off. It is not a launch failure. An invalid value is off. The operator can set it again from the `/workflow:config` menu row.

The `/workflow:config` menu has a Jev routing row after the capability rows. The row shows the current value and edits only the draft. The choice is saved when the operator confirms Apply, and the Apply review lists the change. Cancelling writes nothing. `off` uses the existing dim treatment. The command needs the TUI. Extra arguments, including `settings`, are refused. Print mode does not open the menu.

### Off

Jev is not called. Gated parent tools run. Failing to delegate does not block them. The parent names the child role on launch. `explore` is read-only mapping. `worker` is implementation or command execution. `verify` is verification that may run checks and tests without editing the worktree. A launch with no role does not invent `worker` and does not launch. A named role may launch. A launch does not read the task text. The explore contract still has no shell.

### On

Jev chooses whether the work stays or leaves and which Specialist each launch receives. The parent does not choose the Specialist again. A suggested role does not override Jev.

One Jev call always answers destination and Specialist. The destination is decided once per user message, by the tool gate or by the first launch. The Specialist is decided per launch: each launch asks Jev with its own task, so the launches of one message, such as those of one `codemode` script, can receive different Specialists. The first launch of a message may cost two Jev calls. Jev's `leave` criterion covers an explicit request in the latest user message for a child, subagent, or delegation, in any language or wording, and its `stay` criterion excludes it. The `leave` criterion also covers a user request for an independent review or check of work, which must run in a session other than the parent, and `stay` excludes that too.

`stay` lets the next gated parent tool run. It does not launch. It is not Launch blocked. `decide` tells the parent to ask one question and wait. It does not launch. `leave` does not launch by itself. It tells the parent to launch the Specialist Jev chose for the message. Once a child has launched for that user message, the parent's gated tools run for the rest of that message without asking Jev again. Before the launch, `leave` still blocks.

One destination is kept for one user message. A new user message asks again. Starting a turn does not by itself discard the destination for the same message. Launches of the same message that run while the destination is undecided wait for the first launch that asks Jev. On every launch after the destination is decided, Jev's destination answer is ignored, including `stay` and `decide`. While the destination is `stay` or `decide`, a launch is refused with that destination's warning and does not ask Jev. Launch blocked is not kept as the destination. The next gated parent tool or launch for the same message asks Jev again, and when a destination is already decided, a launch that is Launch blocked leaves it unchanged.

Jev is asked through Pi's classifier model registry, always as `typesafe/jev-latest`. Another provider's Jev is not a substitute, and its credentials alone do not count. The harness does not keep its own Jev client. A missing key, a missing `typesafe/jev-latest` classifier, a classification whose stop reason is not `stop` (`error`, or `aborted` when the turn is cancelled), or a label outside the criteria blocks the launch and blocks a gated parent tool. The warning is Launch blocked. The harness does not invent `stay` or `worker`.

### Both modes

An engineering skill name does not select a destination or a Specialist. The harness does not load skill files and does not match skill names for routing.

The explore child does not run commands. A tool result that did not run is not invented.

The gated parent tools are `read`, `grep`, `find`, `ls`, `edit`, `write`, `bash`, `powershell`, and `codegraph` `query` or `explore`. A gated tool called from a `codemode` script follows the same verdict as a direct call. When that call is blocked, the script receives the block reason, and the parent model also receives it outside the script, so a script cannot hide it. The parent receives at most one such gate message per turn, while every blocked call still receives its reason. `codemode` itself is not gated.

This contract owns the destination and the Specialist. It does not choose a model. The parent model never changes. The model profile chooses the child's model, and a profile entry may name any model in Pi's catalog, including a virtual model.

The child session runs in the parent process through the Pi SDK. This is a design constraint, not a tested behavior.

The child command policy for `git` and `gh` is the same whether routing is on or off, as [ADR 0013](../adr/0013-child-command-policy-for-git-and-gh.md) decides. A child reads `git` and GitHub state on its own. Mutating `git` subcommands from inside the child's worktree, and mutating or publishing `gh` commands from any directory, stay with the parent: the child's `bash` defines `git` and `gh` as shell functions on the model's command line that refuse them with a message telling the child to continue and list the command in its result. `git` from outside the worktree runs, and so do processes the command starts, such as npm scripts, hooks, and `sh -c`. An absolute path, `command git`, a config alias, a `GIT_*` override, a descendant process, or `git -C <repo>` from outside the worktree bypasses that policy guard. Neither routing mode gives the explore contract a shell.

## Testing decisions

Tests cross the routing seam and the `/workflow:config` menu, not private helpers.

- A missing choice document is off and does not call Jev.
- Changing the menu row to on and confirming Apply persists across a new process. Restart does not reset it. The model profiles document is unchanged.
- While off, a gated parent tool runs. A task that mentions `git` or `gh` launches with its named role. A launch with no role does not launch and does not invent `worker`. A named role may launch. Jev is not called.
- While on, `stay` lets the next gated tool run. `decide` blocks it and does not say to launch. `leave` names the Specialist Jev chose and does not let the parent tool run. After a launch for the same message, the parent tool runs and Jev is not asked again.
- An explicit child request while on asks Jev for the destination and the Specialist in the same call.
- A skill name in the user message does not change the destination or the Specialist.
- The same user message reuses one destination. A different message asks again. After Launch blocked, the next gated tool or launch for the same message asks Jev again.
- While on, each launch of a script asks Jev for its Specialist, and different Specialists launch. The destination is decided once, and later destination answers, including `stay` and `decide`, are ignored. A launch with an invalid Jev answer is Launch blocked and is not kept, and the others proceed. When a later launch is Launch blocked, the message keeps its destination. A gate destination of `stay` or `decide` refuses the launches without asking Jev.
- Several blocked inner calls of a script in one turn produce one gate message.
- A missing key while on is Launch blocked. A missing key while off is not. While on, a missing `typesafe/jev-latest` classifier, credentials for another provider's Jev alone, a stop reason other than `stop`, or a label outside the criteria is Launch blocked.
- With routing on and off, the child's `bash` runs `git` and `gh` reads, refuses each reserved `git` subcommand from inside the child's worktree and each reserved `gh` command from any directory with the same message, runs `git` from outside the worktree, and runs a command that only names them as an argument.
- A gated tool called from a `codemode` script follows the same verdict as a direct call. When it is blocked, the parent model receives the block reason even if the script drops it. While on, a `codemode` script that calls no gated tool runs after `leave`.
- Launching a child does not change the parent's model or thinking. A profile entry that names a virtual model launches the child on that model.
- The explore contract still has no shell. A result does not claim a command ran unless that output is present.

## Out of scope

Giving the explore contract a shell. Putting the choice inside the model profiles document. Using the TypeSafe key as the switch. Detecting a "do not delegate" phrase. Claiming compatibility with another product's orchestration. Accepting ADR 0008 by the presence of its file. Changing the historical delegation spec's READY status. Choosing the parent's model per turn, including a Pi virtual model that consults Jev. Shipping a pi-workflow virtual model or a per-request router for children. Running a child as a separate `pi` process.

## Prototype

None. The historical operator prototype remains reference-only for the previous delegation feature. It is not evidence for this change.

## Approved deviations

The historical delegation spec still routes by skill name and has no off mode. That spec is not the contract for this change. ADR 0008 records the decision. Accepted ADR 0005 still owns the child session as a harness capability.

## Accepted risks

A Jev choice can vary between messages. That is the cost of turning Jev on.

## Dependencies

Pi 1.0 or later, Pi child sessions, the `/workflow:config` menu, the Pi agent directory that already holds model profiles, and `typesafe/jev-latest` through Pi's classifier model registry when routing is on. Engineering skill files stay outside this package.

## Feature review

Final verdict: READY WITH WARNINGS. The renewed review is the handoff. Historical READY and READY WITH WARNINGS on the delegation spec do not cover this change.
