# Installed Files

A run leaves only consumer files behind; no skill reads anything from the installed `setup-workflow` between runs. Uninstall it after a run and reinstall it to update the playbooks, or when a skill reports a missing or outdated playbook and points to `setup-workflow`.

| File | Written by | Read by |
| --- | --- | --- |
| Routing block in `AGENTS.md` | `routing --append` | Every agent that reads `AGENTS.md`; it routes each task to the playbooks below. |
| `docs/agents/workflow.md` | `update` | Every agent, through the routing block; `pr-review` for precedence. |
| `docs/agents/issue-tracker.md` | `update` | `create-pr`, `pr-review`, and `qa-impact` by name, and every skill that reads or publishes tickets through the recorded tracker. |
| `docs/agents/domain.md` | `update`; `domain-modeling` writes only its authority region | `domain-modeling` and `pr-review` by name; `diagnose-bug`, `feature`, `feature-critic`, `implement`, `prototype`, and `to-spec` through its Domain Authority Handoff. |
| `docs/agents/quality.md` | `update` | `code-review`, `create-pr`, `diagnose-bug`, `implement`, and `implement-spec`. |
| `docs/agents/pull-requests.md` | `update` | `create-pr`, `domain-modeling`, `feature`, `implement`, `implement-spec`, `prototype`, `pr-review`, `qa-impact`, `to-spec`, and `to-tickets`. |
| `docs/agents/coding-standards.md` | Created once when absent; consumer-owned afterward | `code-review`, `codebase-design`, `diagnose-bug`, and `pr-review`. |

The glossary-map validator ships with `domain-modeling`, so a map keeps validating with `setup-workflow` uninstalled. Reinstall `setup-workflow` beside `domain-modeling`: its script loads that sibling validator and refuses every command when it is missing.
