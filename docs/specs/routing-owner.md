# Routing owner

Status: Published. Not implemented.

Package: the confirmed routing package after the renewed feature review.
Review handoff: READY WITH WARNINGS. ADR 0008 is a local record, not accepted authority.
Verdict: READY WITH WARNINGS.

## Problem

The operator talks to one parent session. Routing can trap that session: gated tools stay blocked, the explore child has no shell, and a skill name can select a Specialist. The operator needs one owner for routing, and a persistent choice of whether that owner is Jev.

## Solution

Jev routing is one persistent choice. It is off until the operator turns it on. While it is off, the parent names the child role and Jev is not called. While it is on, Jev chooses whether the work stays or leaves and which Specialist launches. An engineering skill name never selects a Specialist.

The seam is the routing module behind the extension adapter. Callers see the stored choice, the settings list, and the launch result. They do not see where the choice is stored.

## User stories

- As the operator, I start with Jev routing off, and my choice remains until I change it.
- As the operator, I turn Jev routing on or off from the existing settings list.
- As the operator, I can run `git` and `gh` in the parent while routing is off.
- As the operator, I am not blocked because a skill name appeared in my message.

## Implementation decisions

### The choice

Jev routing is off until the operator turns it on. The choice persists until the operator changes it. Restarting Pi does not reset it. It is stored in the user's Pi configuration, in the same directory as the model profiles, in a separate document. It is not a field of the model profiles document. The TypeSafe key is not the switch.

A missing or unreadable choice document is off. It is not a launch failure. An invalid value is off. The operator can set it again from the settings list.

The settings command opens the existing settings list. The row shows the current value. `off` uses the existing dim treatment. The command needs the TUI. Extra arguments are refused. Print mode does not open the list.

### Off

Jev is not called. Gated parent tools run. Failing to delegate does not block them. The parent names the child role on launch. `explore` is read-only mapping. `worker` is implementation or command execution. `verify` is read-only verification. A launch with no role does not invent `worker` and does not launch. A named role may launch. Invocations of `git` and `gh` are the repository-state commands. While routing is off they stay in the parent. A named role does not move them to a child. The explore contract still has no shell.

### On

Jev chooses whether the work stays or leaves and which Specialist launches. The parent does not choose the Specialist again. A suggested role does not override Jev.

An explicit request in the latest user message for a child, subagent, or delegation fixes the destination to leave. Jev still chooses the Specialist. Jev is not asked whether to stay.

`stay` lets the next gated parent tool run. It does not launch. It is not Launch blocked. `decide` tells the parent to ask one question and wait. It does not launch. `leave` does not launch by itself. It tells the parent to launch the Specialist Jev chose.

One verdict is kept for one user message. A new user message asks again. Starting a turn does not by itself discard the verdict for the same message.

A missing key, a transport or parse failure, or a label outside the criteria blocks the launch and blocks a gated parent tool. The warning is Launch blocked. The harness does not invent `stay` or `worker`.

### Both modes

An engineering skill name does not select a destination or a Specialist. The harness does not load skill files and does not match skill names for routing.

The explore child does not run commands. A tool result that did not run is not invented.

The gated parent tools are `read`, `grep`, `find`, `ls`, `edit`, `write`, `bash`, `powershell`, and `codegraph` `query` or `explore`.

Invocations of `git` and `gh` stay in the parent only while routing is off. A named role does not move them to a child while routing is off. While routing is on, Jev may leave that work to a Specialist. That does not give the explore contract a shell.

## Testing decisions

Tests cross the routing seam and the settings list, not private helpers.

- A missing choice document is off and does not call Jev.
- Changing the settings row to on persists across a new process. Restart does not reset it. The model profiles document is unchanged.
- While off, a gated parent tool runs. Invocations of `git` and `gh` stay in the parent. A named role does not move them to a child. A launch with no role does not launch and does not invent `worker`. A named role may launch. Jev is not called.
- While on, `stay` lets the next gated tool run. `decide` blocks it and does not say to launch. `leave` names the Specialist Jev chose and does not let the parent tool run.
- An explicit child request while on does not ask Jev for the destination and still asks for the Specialist.
- A skill name in the user message does not change the destination or the Specialist.
- The same user message reuses one verdict. A different message asks again.
- A missing key while on is Launch blocked. A missing key while off is not.
- The explore contract still has no shell. A result does not claim a command ran unless that output is present.

## Out of scope

Giving the explore contract a shell. Putting the choice inside the model profiles document. Using the TypeSafe key as the switch. Detecting a "do not delegate" phrase. Claiming compatibility with another product's orchestration. Accepting ADR 0008 by the presence of its file. Changing the historical delegation spec's READY status.

## Prototype

None. The historical operator prototype remains reference-only for the previous delegation feature. It is not evidence for this change.

## Approved deviations

The historical delegation spec still routes by skill name and has no off mode. That spec is not the contract for this change. ADR 0008 records the decision and is not accepted authority. Accepted ADR 0005 still owns the child session as a harness capability.

## Accepted risks

The installed switch starts on and does not persist. That behavior is not the contract. A Jev choice can vary between messages. That is the cost of turning Jev on.

## Dependencies

Pi child sessions, the existing settings list, the Pi agent directory that already holds model profiles, and Jev when routing is on. Engineering skill files stay outside this package.

## Feature review

Final verdict: READY WITH WARNINGS. The renewed review is the handoff. Historical READY and READY WITH WARNINGS on the delegation spec do not cover this change.
