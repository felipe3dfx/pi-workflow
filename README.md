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
/workflow:settings
```

`/workflow:status` and `/workflow:doctor` are read-only. They report companions, MCP alignment, settings alignment, and colliding packages.

`/workflow:configure` takes no arguments. It opens a guided review, then applies the local selection in the current session. It:

- installs missing companions whose expectation is on. A failed install still aligns MCP servers and default settings and leaves the harness degraded; an uncertain effect is not retried. Turning an expectation off does not uninstall the package.
- aligns Pi-native MCP servers in `mcp.json` in the Pi agent directory from `assets/mcp-servers.json`, per catalog key. Keys you or Pi manage are preserved. `context7` is exposed directly; `sentry` and `linear` are `codemode-deferred`. Servers that need OAuth are authorized with `/mcp login <server>`.
- applies the default Pi settings from `assets/settings.json`: `tuiMode` `fullscreen`, `theme` `pi-workflow`, `quietStartup`, and `defaultTools` `+codemode`, which enables the built-in `codemode` tool.
- warns about colliding packages and never removes them. See below.
- notes a legacy `mcp-adapter.json`, which is no longer read.

`/workflow:subagents` (`alt+a`) opens the children view for the current session.

`/workflow:delegation-check` scores a fixed set of delegation cases against Jev and prints pass or fail for each one. It asks Jev through Pi's classifier registry, like a launch. It does not launch a child. It needs a TypeSafe API key, and a missing key is a fail line. It also needs Jev routing on: while routing is off, each case that calls Jev is a fail line, and Jev is not asked. It is not part of `npm run check`.

`/workflow:settings` opens the settings list. Jev routing starts off. The choice is saved in `pi-workflow-routing.json` in the Pi agent directory and survives a restart; it does not change `pi-workflow-models.json`. While it is off, Jev is not asked and a launch needs a role. A launch does not read the task text; a child's `bash` puts `git` and `gh` stubs first on `PATH`, so any command, script, or interpreter that runs them gets a message telling the child to report blocked or ask the parent. An absolute path to the real binary, or a command that resets `PATH`, bypasses the stubs, so it is a policy guard, not a sandbox.

## Model profiles

`/workflow:models` opens a modal panel over `pi-workflow-models.json` in the Pi agent directory. You create, duplicate, rename, delete, and activate profiles, and pick a model and a thinking level for each specialist. A save applies immediately.

A profile assigns a model and thinking level to three specialists: `explorer`, `worker`, and `verifier`. A child's role selects the specialist of the active profile: `explore` to `explorer`, `worker` to `worker`, `verify` to `verifier`. A specialist with no entry inherits the session model and thinking. A model that Pi does not have, or a thinking level the model does not support, refuses the launch. A schema v1 file is refused. On `spawn_child` with Jev routing off, the passed role decides, and the response says `Launched as <role>`. A background launch tells the parent to end its turn and not poll; the result arrives as a message. With Jev routing on, a passed role is a suggestion. It does not replace a role already chosen for that user message. A missing role is not `worker` and does not warn that `worker` was assumed. Jev selects `explorer`, `worker`, or `verifier` and may override that suggestion. The harness maps the choice to `explore`, `worker`, or `verify`. Model and thinking still come from the active profile for that specialist. Jev is consulted from `spawn_child` and from the parent's `tool_call` hook. Child sessions are started with extensions disabled, so the hook does not apply to them. One verdict is kept until the next operator message. Starting a model turn does not drop it. Launch blocked is not kept: the next gated tool or launch for the same message asks Jev again. Unseating child session leaves the gate inert. The hook does not ask Jev and does not block `spawn_child`, `continue_child`, `reply_child`, `cancel_child`, `list_children`, `child_status`, `child_result`, `ask_user_choice`, `ask_user_question`, or `todo`. It does not ask or block `codegraph` `init`, or a `read` of `AGENTS.md`, `GLOSSARY.md`, or `docs/agents/<file>.md` resolved inside the session cwd. Those reads are the only trivial exception. There is no file-count threshold. `read`, `grep`, `find`, `ls`, `edit`, `write`, `bash`, `powershell`, and `codegraph` `query` or `explore` are gated. A gated tool called from a `codemode` script follows the same verdict as a direct call. When that call is blocked, the script receives the reason and the parent model also receives it as a message, so a script cannot hide it. `codemode` itself is not gated. The first gated tool of the turn sends the latest user message as both the task and the user request. The hook adds no suggested role. If that turn has no user message, the tool runs and Jev is not asked. A named engineering skill does not select the destination or the specialist, and the harness does not load skill files. One Jev call always answers destination and specialist. Jev's `leave` criterion covers an explicit request for a child, subagent, or delegation, and a request for an independent review or check of work, which must run in a session other than the parent. `decide` means a product decision is still open: the gated tool is blocked, the parent asks one question and waits, and no child is launched. `stay` means the package is small and already understood: the gated tool runs, and later gated tools in the turn do not ask again. On `spawn_child`, `stay` keeps the work in this session. `leave` blocks the gated tool. The reason tells the parent to call `spawn_child` and names the role, and `spawn_child` launches that specialist. Once `spawn_child` has launched a child for that user message, the parent's gated tools run for the rest of that message without asking Jev again; before the launch, `leave` keeps blocking. `spawn_child` in that same turn reuses the verdict. Investigating an architecture can leave. Choosing an architecture with the user is `decide`. Jev is asked through Pi's classifier registry, always as `typesafe/jev-latest`, with the turn's cancellation signal. The harness keeps no Jev client of its own. Another provider's Jev is not a substitute, and its credentials alone do not count. A missing key, a missing `typesafe/jev-latest` classifier, a classification whose stop reason is not `stop` (`error`, or `aborted` when the turn is cancelled), or a label outside the criteria blocks the gated tool and the launch with "Launch blocked". That is not "The work stays in this session", and the harness does not invent stay or fill `worker`. Confidence is kept and does not change the decision. An invalid profiles file or an invalid worktree still refuses the launch. Those checks run before Jev when `spawn_child` asks, and still run when it reuses the verdict. The selected specialist's missing contract, unavailable model, or unsupported thinking refuses after Jev. Launching a child does not change the parent's model or thinking. A profile entry may name any model in Pi's catalog, including a virtual model, and the child runs on it. Jev does not choose a model, quota failover, workflow authorization, or result correctness. Dynamic model routing, confidence thresholds, and a Jev-verified model cascade are later work. Jev needs a TypeSafe API key: run `/login` and choose TypeSafe, or set `TYPESAFE_API_KEY`.

## Theme and chrome

The package ships the `pi-workflow` theme (`themes/pi-workflow.json`). The extension restyles Pi's terminal UI in the Grok Build style: a header, footer key hints, a status row, a rounded input editor whose model label is colored by thinking level, autocomplete above the box, and slash-command coloring. It also restyles messages (user block with timestamp, `Thought for Ns` line, a thick left bar on expanded thinking, assistant timestamps) and menus (select lists, settings lists, Pi's selectors, and the settings submenus).

This works by patching Pi internals copied from Pi 1.0.3, with no version guard. Re-verify it on every Pi upgrade. See ADR 0007.

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
- Pi CLI `>=1.0.3` available in the target environment
