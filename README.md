# @felipe.3dfx/pi-workflow

A Pi harness package. Version 0.2.0 removes the 0.1.x product workflow. Product workflow no longer lives here.

Grupo Ilao engineering skills own process semantics: discovery, specification, tickets, implementation, review, QA impact, and publication. This package reports and installs the companion packages those skills ask a Pi harness to provide, aligns their MCP servers and default Pi settings, and owns child sessions and the terminal chrome. It does not publish Linear issues, store workflow artifacts, or reconcile uncertain external effects.

## Commands

```text
/workflow:status
/workflow:doctor
/workflow:setup
/workflow:models
/workflow:subagents
```

`/workflow:status` and `/workflow:doctor` are read-only. They report companions, MCP alignment, settings alignment, and colliding packages.

`/workflow:setup` takes no arguments. It:

- installs the missing companions listed in `assets/companions.json`. A failed install stops; an uncertain effect is not retried.
- aligns Pi-native MCP servers in `mcp.json` in the Pi agent directory from `assets/mcp-servers.json`, per catalog key. Keys you or Pi manage are preserved. `context7` is exposed directly; `sentry` and `linear` are deferred. Servers that need OAuth are authorized with `/mcp login <server>`.
- applies the default Pi settings from `assets/settings.json`: `tuiMode` `fullscreen`, `theme` `pi-workflow`, and `quietStartup`.
- warns about colliding packages and never removes them. See below.
- notes a legacy `mcp-adapter.json`, which is no longer read.

`/workflow:subagents` (`alt+a`) opens the children view for the current session.

## Model profiles

`/workflow:models` opens a modal panel over `pi-workflow-models.json` in the Pi agent directory. You create, duplicate, rename, delete, and activate profiles, and pick a model and a thinking level for each specialist. A save applies immediately.

A profile assigns a model and thinking level to three specialists: `explorer`, `worker`, and `verifier`. A child's role selects the specialist of the active profile: `explore` to `explorer`, `worker` to `worker`, `verify` to `verifier`. A specialist with no entry inherits the session model and thinking. A model that Pi does not have, or a thinking level the model does not support, refuses the launch. A schema v1 file is refused. Jev is asked only whether the work stays or leaves the session, after the local checks. Jev needs a TypeSafe API key: run `/login` and choose TypeSafe, or set `TYPESAFE_API_KEY`.

## Theme and chrome

The package ships the `pi-workflow` theme (`themes/pi-workflow.json`). The extension restyles Pi's terminal UI in the Grok Build style: a header, footer key hints, a status row, a rounded input editor whose model label is colored by thinking level, autocomplete above the box, and slash-command coloring. It also restyles messages (user block with timestamp, `Thought for Ns` line, a thick left bar on expanded thinking, assistant timestamps) and menus (select lists, settings lists, Pi's selectors, and the settings submenus).

This works by patching Pi internals copied from Pi 0.99.1, with no version guard. Re-verify it on every Pi upgrade. See ADR 0007.

## Colliding packages

These packages overlap with what the harness owns. Status and doctor warn about them. Setup never removes them.

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
