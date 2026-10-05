# @felipe.3dfx/pi-workflow

A Pi harness package for companion readiness, harness capabilities, child sessions, and terminal chrome. Product workflow remains in Grupo Ilao engineering skills; this package does not publish Linear issues or store workflow artifacts.

## Commands

| Command | What it does | Implementation | Tests |
| --- | --- | --- | --- |
| `/workflow:status` | Summarizes readiness | [`extensions/companion-workflow.ts`](extensions/companion-workflow.ts) | [`test/companion-workflow.test.mjs`](test/companion-workflow.test.mjs) |
| `/workflow:doctor` | Shows companion diagnostics | [`extensions/companion-workflow.ts`](extensions/companion-workflow.ts) | [`test/companion-workflow.test.mjs`](test/companion-workflow.test.mjs) |
| `/workflow:config` | Reviews and applies local companion/capability selection | [`extensions/pi-workflow.ts`](extensions/pi-workflow.ts), [`extensions/companion-workflow.ts`](extensions/companion-workflow.ts) | [`test/companion-workflow.test.mjs`](test/companion-workflow.test.mjs) |
| `/workflow:config settings` | Opens Jev routing settings | [`extensions/workflow-settings.ts`](extensions/workflow-settings.ts) | [`test/workflow-settings.test.mjs`](test/workflow-settings.test.mjs) |
| `/workflow:models` | Edits model profiles | [`extensions/model-profiles.ts`](extensions/model-profiles.ts) | [`test/model-profiles.test.mjs`](test/model-profiles.test.mjs) |
| `/workflow:subagents` | Opens the children view | [`extensions/children-view.ts`](extensions/children-view.ts) | [`test/child-sessions.test.mjs`](test/child-sessions.test.mjs) |
| `/workflow:delegation-check` | Checks fixed Jev delegation cases; does not launch children | [`extensions/delegation-check.ts`](extensions/delegation-check.ts) | [`test/delegation-check.test.mjs`](test/delegation-check.test.mjs) |

Run `/workflow:config` in the TUI to review and apply a selection. Expected missing companions may be installed; MCP servers and default Pi settings are aligned. Nothing is uninstalled. Run `/workflow:config settings` to change Jev routing, which is off by default and persists separately from model profiles.

For configuration decisions and behavior, see [ADR 0009](docs/adr/0009-guided-configure.md). For Jev routing and child-session behavior, see [the routing-owner specification](docs/specs/routing-owner.md) and [child-session delegation specification](docs/specs/child-session-delegation.md). These documents are authoritative; this README is a navigation map, not a duplicate specification.

## Internal communication and publication language

Parent-child instructions, questions, findings, and results are always in English. User-facing communication follows the user's language. Any artifact intended for eventual Linear publication must be professional neutral Spanish before Owner approval; this artifact-language rule does not change the English internal communication contract.

## Model profiles

`/workflow:models` assigns a model and thinking level to each child specialist. See the [child-session delegation specification](docs/specs/child-session-delegation.md) for role selection, Jev behavior, and launch rules.

## Theme and chrome

The package ships the `pi-workflow` theme and restyles Pi's terminal UI. The chrome patches Pi internals copied from Pi 1.0.3 without a version guard; re-verify them on every Pi upgrade. See [ADR 0007](docs/adr/0007-patch-pi-tui-internals-for-chrome.md).

## Colliding packages

Status, doctor, and config warn about packages that overlap with harness functionality. Config never removes them.

- `@heyhuynhgiabuu/pi-pretty` registers the same tool names.
- `pi-powerline-footer` replaces the same header, footer, and editor.
- `pi-mcp-adapter` replaces Pi's built-in `/mcp`, so Pi ignores `mcp.json` while it is installed.

## Install

```bash
pi install npm:@felipe.3dfx/pi-workflow
```

Reload Pi, then inspect the harness with `/workflow:status`. Install engineering skills from the Grupo Ilao catalog into the consumer repository; this package does not bundle them. The 0.1.x product workflow commands and `pi-workflow-sync` are gone.

## Disposable Pi test launcher

```bash
npm run pi:sandbox
```

The launcher isolates Pi home, configuration, packages, and sessions. It is not a filesystem security sandbox.

## Requirements

- Node.js `>=22.19`
- Pi CLI `>=1.0.3` available in the target environment
