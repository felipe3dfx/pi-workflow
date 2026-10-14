# ADR 0017: Jev routes destinations and children share context

## Status

Acceptance: approval and merge of the introducing PR.

## Decision

Supersedes: ADR-0008 (only its Jev-selected-Specialist routing clause); ADR-0014 (only its explorer-context clause, as retained by ADR-0016); ADR-0016 (only its retention of that explorer-context clause).

Jev routing remains an operator-controlled persistent choice. When it is on, Jev classifies each user message once and decides only whether the work stays in the parent, leaves for a child, or cannot be decided. It does not select a Specialist or child role. The parent retains the Tool gate: each gated parent tool call is checked against that message's destination decision.

When a child is launched, the parent must supply its role. The supplied role is honored for that launch. A role selected or used for one launch must not be cached and carried into a sibling launch. A gate block directs the parent to delegate without naming a role; the parent supplies a role when it launches. Continuing an existing child continues that child's session and role.

When Jev routing is off, behavior is unchanged: the parent decides whether and which role to launch, and no implicit worker fallback is introduced. Jev is not called to choose a role in this mode.

Every child role, including `explore`, loads the Pi context files available through the agent directory, the worktree's ancestors, and the repository, after its role Contract. The same context-loading rule applies to every role; there is no explorer-specific context omission and no context filter. `APPEND_SYSTEM` remains suppressed, and children still do not load skills.

Context files describe the project. A child's Contract takes precedence over them; any instruction in them to ask the user, delegate, launch children, commit, push, or publish does not apply to the child.

Per-role tool allowlists remain in force. ADR 0013's child `bash` guard for `git` and `gh` remains in force. Claude Bridge provider resolution, role tool sets, model profiles, continuation, and delivery are unchanged.

Rejected alternatives:

- Give every role a uniform tool set. This is simpler and code-guaranteed, but the operator chose to retain per-role tool sets.
- Filter context using Gentle Shell-style markers. This does not apply: pi-workflow is a harness for consumer repositories and does not author their context files.
- Keep Jev's Specialist selection. This caused worker-to-explore reroutes that could leave children without bash or context.
- Fall back to `worker` when a role is absent. No implicit role fallback is introduced.

Consequences:

Every child role receives the context chain, including `explore`. This accepts full context-chain exposure; the Contract precedence rule mitigates the risk by making context-file instructions to ask the user, delegate, launch children, commit, push, or publish inapplicable to the child.

Jev determines a destination once per user message, while the parent remains responsible for supplying each launch's role. The child's role does not leak between sibling launches. Existing per-role tool permissions and the `git`/`gh` child bash guard remain unchanged.
