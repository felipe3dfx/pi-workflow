# @felipe.3dfx/pi-workflow

A Pi harness package. Version 1.0.0 removes the 0.1.x product workflow. Product workflow no longer lives here.

Grupo Ilao engineering skills own process semantics: discovery, specification, tickets, implementation, review, QA impact, and publication. This package reports and installs the companion packages those skills ask a Pi harness to provide, aligns their MCP servers and default Pi settings, and owns child sessions and the terminal chrome. It does not publish Linear issues, store workflow artifacts, or reconcile uncertain external effects.

## Commands

```text
/workflow:status
/workflow:doctor
/workflow:configure
/workflow:models
/workflow:subagents
/workflow:delegation-check
```

`/workflow:status` and `/workflow:doctor` are read-only. They report companions, MCP alignment, settings alignment, and colliding packages.

`/workflow:configure` takes no arguments. It opens a guided review, then applies the local selection in the current session. It:

- installs missing companions whose expectation is on. A failed install stops; an uncertain effect is not retried. Turning an expectation off does not uninstall the package.
- aligns Pi-native MCP servers in `mcp.json` in the Pi agent directory from `assets/mcp-servers.json`, per catalog key. Keys you or Pi manage are preserved. `context7` is exposed directly; `sentry` and `linear` are `codemode-deferred`. Servers that need OAuth are authorized with `/mcp login <server>`.
- applies the default Pi settings from `assets/settings.json`: `tuiMode` `fullscreen`, `theme` `pi-workflow`, `quietStartup`, and `defaultTools` `+codemode`, which enables the built-in `codemode` tool.
- warns about colliding packages and never removes them. See below.
- notes a legacy `mcp-adapter.json`, which is no longer read.

`/workflow:subagents` (`alt+a`) opens the children view for the current session.

`/workflow:delegation-check` scores a fixed set of delegation cases against Jev and prints pass or fail for each one. It does not launch a child. It needs a TypeSafe API key, and a missing key is a fail line. It is not part of `npm run check`.


## Model profiles

`/workflow:models` opens a modal panel over `pi-workflow-models.json` in the Pi agent directory. You create, duplicate, rename, delete, and activate profiles, and pick a model and a thinking level for each specialist. A save applies immediately.

A profile assigns a model and thinking level to three specialists: `explorer`, `worker`, and `verifier`. A child's role selects the specialist of the active profile: `explore` to `explorer`, `worker` to `worker`, `verify` to `verifier`. A specialist with no entry inherits the session model and thinking. A model that Pi does not have, or a thinking level the model does not support, refuses the launch. A schema v1 file is refused. On `spawn_child`, a passed role is a suggestion. It does not replace a role already chosen for that user message. A missing role is not `worker` and does not warn that `worker` was assumed. Jev selects `explorer`, `worker`, or `verifier` and may override that suggestion. The harness maps the choice to `explore`, `worker`, or `verify`. Model and thinking still come from the active profile for that specialist. Jev is consulted from `spawn_child` and from the parent's `tool_call` hook. Child sessions are started with extensions disabled, so the hook does not apply to them. One verdict is kept per user turn. `turn_start` drops it. The hook does not ask Jev and does not block `spawn_child`, `continue_child`, `reply_child`, `cancel_child`, `list_children`, `child_status`, `child_result`, `ask_user_choice`, `ask_user_question`, or `todo`. It does not ask or block `codegraph` `init`, or a `read` of `AGENTS.md`, `CONTEXT.md`, or `docs/agents/<file>.md` resolved inside the session cwd. Those reads are the only trivial exception. There is no file-count threshold. `read`, `grep`, `find`, `ls`, `edit`, `write`, `bash`, `powershell`, and `codegraph` `query` or `explore` are gated. The first gated tool of the turn sends the latest user message as both the task and the user request. The hook adds no suggested role. If that turn has no user message, the tool runs and Jev is not asked. A named engineering skill in the latest user message selects the destination and specialist in code, and Jev is not called. `feature-review`, `code-review`, `review-critique`, `promotion-readiness`, and `mutation-testing` leave as `verify`. `simplify`, `scope-audit`, and `qa-impact` leave as `explore`. `implement` and `tdd` leave as `worker`. `codebase-design`, `feature`, `domain-modeling`, `to-tickets`, and `create-pr` stay in the parent, including when the message also asks for a child. `prototype`, `to-spec`, `setup-workflow`, and `writing-for-agents` stay until that same message also shows approval (`aprobado`, `approved`, `publica`, `publish`, or `hazlo`); then they leave as `worker`. Longer names match first, and a hyphen is part of the name. Without a skill match, an explicit request for a child, subagent, or delegation fixes the destination to a child, so Jev is not asked where the work should go. Otherwise one Jev call answers destination and specialist. `decide` means a product decision is still open: the gated tool is blocked, the parent asks one question and waits, and no child is launched. `stay` means the package is small and already understood: the gated tool runs, and later gated tools in the turn do not ask again. On `spawn_child`, `stay` keeps the work in this session. Explicit intent or `leave` blocks the gated tool. The reason tells the parent to call `spawn_child` and names the role, and `spawn_child` launches that specialist. `spawn_child` in that same turn reuses the verdict. Investigating an architecture can leave. Choosing an architecture with the user is `decide`. A missing key, a transport or parse failure, or a label outside the criteria blocks the gated tool and the launch with "Launch blocked". That is not "The work stays in this session", and the harness does not invent stay or fill `worker`. Confidence is kept and does not change the decision. An invalid profiles file or an invalid worktree still refuses the launch. Those checks run before Jev when `spawn_child` asks, and still run when it reuses the verdict. The selected specialist's missing contract, unavailable model, or unsupported thinking refuses after Jev. Jev does not choose a model, quota failover, workflow authorization, or result correctness. Dynamic model routing, confidence thresholds, and a Jev-verified model cascade are later work. Jev needs a TypeSafe API key: run `/login` and choose TypeSafe, or set `TYPESAFE_API_KEY`.

## Theme and chrome

The package ships the `pi-workflow` theme (`themes/pi-workflow.json`). The extension restyles Pi's terminal UI in the Grok Build style: a header, footer key hints, a status row, a rounded input editor whose model label is colored by thinking level, autocomplete above the box, and slash-command coloring. It also restyles messages (user block with timestamp, `Thought for Ns` line, a thick left bar on expanded thinking, assistant timestamps) and menus (select lists, settings lists, Pi's selectors, and the settings submenus).

This works by patching Pi internals copied from Pi 0.99.1, with no version guard. Re-verify it on every Pi upgrade. See ADR 0007.

## Colliding packages

These packages overlap with what the harness owns. Status, doctor, and configure warn about them. Configure never removes them.

- `@heyhuynhgiabuu/pi-pretty` registers the same tool names.
- `pi-powerline-footer` replaces the same header, footer, and editor.
- `pi-mcp-adapter` replaces Pi's built-in `/mcp`, so Pi ignores `mcp.json` while it is installed.

## Install

```bash
pi install npm:@felipe.3dfx/pi-workflow
```

Reload Pi, then inspect the harness:

```text
/reload
/workflow:status
```

Install engineering skills from the Grupo Ilao catalog into the consumer repository. This package does not bundle them.

0.1.x commands `/define-product`, `/deliver-ticket`, `/qa-handoff`, and `/product-review` are gone. Use the engineering skills instead. The `pi-workflow-sync` command is gone with the packaged agent assets.

## Disposable Pi test launcher

```bash
npm run pi:sandbox
```

The launcher isolates Pi home, configuration, packages, and sessions. It is not a filesystem security sandbox.

## Requirements

- Node.js `>=22.19`
- Pi CLI `>=0.99.0` available in the target environment
