# ADR 0008: One owner for routing

## Status

Acceptance: approval and merge of the introducing PR.

## Decision

Routing has one owner at a time. Jev routing is off until the user turns it on. That choice persists until the user changes it. It is stored in the user's Pi configuration, beside the model profiles.

While Jev routing is off, the parent names the child role. Read-only mapping uses `explore`. Implementation or command execution uses `worker`. Read-only verification uses `verify`. Commands that read repository state, including `git` and `gh`, stay in the parent session. A launch with no role does not invent `worker`.

While Jev routing is on, Jev chooses whether the work stays or leaves and which Specialist launches. The parent does not choose the Specialist again.

An engineering skill name does not select a Specialist in either mode. Those skills belong to another repository. They are not part of the installed extension's contract with Pi. Supersedes: none.

## Considered Options

- Let Jev choose the Specialist even when routing is off, and block the parent when Jev cannot answer.
- Let the parent always choose the Specialist, and limit Jev to stay or leave.
- Give routing one owner at a time, and never let a skill name choose the Specialist.

## Consequences

The launcher still matches skill names until a later code change removes that table. Until then, the installed extension does not follow this decision. Turning routing on or off persists until the user changes it. Restarting Pi does not reset it. The choice is stored in the user's Pi configuration, beside the model profiles, not in each repository and not in process memory. A missing key, a transport failure, or an invalid label still blocks a launch while routing is on. The harness does not invent a stay verdict in that case.
