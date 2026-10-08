# @felipe.3dfx/pi-workflow

A Pi harness package for companion readiness, harness capabilities, child sessions, and terminal chrome. Product workflow remains in Grupo Ilao engineering skills; this package does not publish Linear issues or store workflow artifacts.

## Commands

| Command | What it does | Implementation | Tests |
| --- | --- | --- | --- |
| `/workflow:status` | Summarizes readiness | [`extensions/companion-workflow.ts`](extensions/companion-workflow.ts) | [`test/companion-workflow.test.mjs`](test/companion-workflow.test.mjs) |
| `/workflow:doctor` | Shows companion diagnostics | [`extensions/companion-workflow.ts`](extensions/companion-workflow.ts) | [`test/companion-workflow.test.mjs`](test/companion-workflow.test.mjs) |
| `/workflow:config` | Reviews and applies local companion/capability selection | [`extensions/pi-workflow.ts`](extensions/pi-workflow.ts), [`extensions/configure.ts`](extensions/configure.ts), [`extensions/configure-guide.ts`](extensions/configure-guide.ts), [`extensions/companion-workflow.ts`](extensions/companion-workflow.ts), [`extensions/workflow-settings.ts`](extensions/workflow-settings.ts) | [`test/configure.test.mjs`](test/configure.test.mjs), [`test/companion-workflow.test.mjs`](test/companion-workflow.test.mjs), [`test/workflow-settings.test.mjs`](test/workflow-settings.test.mjs) |
| `/workflow:models` | Edits model profiles | [`extensions/model-profiles.ts`](extensions/model-profiles.ts) | [`test/model-profiles.test.mjs`](test/model-profiles.test.mjs) |
| `/workflow:subagents` | Opens the children view | [`extensions/children-view.ts`](extensions/children-view.ts) | [`test/children-view.test.mjs`](test/children-view.test.mjs) |
| `/workflow:delegation-check` | Checks fixed Jev delegation cases; does not launch children | [`extensions/delegation-check.ts`](extensions/delegation-check.ts) | [`test/delegation-check.test.mjs`](test/delegation-check.test.mjs) |

Run `/workflow:config` in the TUI to review and apply a selection. Expected missing companions may be installed; MCP servers and default Pi settings are aligned. Nothing is uninstalled. The same menu has a Jev routing row, applied with the rest of the plan; routing is off by default and persists separately from model profiles.

For configuration decisions and behavior, see [ADR 0009](docs/adr/0009-guided-configure.md) and [ADR 0012](docs/adr/0012-consolidate-workflow-command-entrypoint.md). For Jev routing and child-session behavior, see [the routing-owner specification](docs/specs/routing-owner.md) and [child-session delegation specification](docs/specs/child-session-delegation.md). These documents are authoritative; this README is a navigation map, not a duplicate specification.

## Operational setup

- Sign in to TypeSafe with `/login` or provide `TYPESAFE_API_KEY`.
- Sign in to an OAuth MCP server with `/mcp login <server>` (for example, `/mcp login sentry`).
- Sentry and Linear tools use deferred CodeMode and are not directly exposed MCP tools.
- `/workflow:config` applies the package's default Pi settings: `tuiMode: "fullscreen"`, `theme: "pi-workflow"`, `quietStartup: true`, and `defaultTools: ["+codemode"]`.
- Workflow choices are stored in the Pi agent directory: `pi-workflow-selection.json`, `pi-workflow-models.json`, and `pi-workflow-routing.json`.
- Legacy `mcp-adapter.json` configuration is not read; the built-in Pi MCP settings are used. See the warning about `pi-mcp-adapter` below.
- Child sessions read `git` and GitHub state on their own; inside the child's worktree only listed `git` reads run, only listed `gh` reads run anywhere, and everything else, including `gh auth` and `git credential`, stays with the parent, whether Jev routing is on or off. The child shell's guard covers only the model's own command line, so npm scripts, hooks, and tests it starts run the real `git` and `gh`. It is a policy boundary, not a security boundary: absolute paths, `command git`, `exec git`, `env git`, `gh` aliases, `GIT_*` overrides, descendant processes such as `sh -c`, or running `git -C <repo>` from outside the worktree can bypass it. See [ADR 0013](docs/adr/0013-child-command-policy-for-git-and-gh.md).
- Child sessions run in the parent's process and carry its risk. Every child reaches the parent's MCP servers with the parent's project trust, and workers and verifiers follow the repository's AGENTS.md; a child's contract still keeps commits, pull requests, and publishing with the parent. See [ADR 0014](docs/adr/0014-in-process-children-carry-the-parent-risk.md).

For internal communication and publication-language requirements, see the [Language Contract in `AGENTS.md`](AGENTS.md#language-contract).

## Model profiles

`/workflow:models` assigns a model and thinking level to each child specialist. See the [child-session delegation specification](docs/specs/child-session-delegation.md) for role selection, Jev behavior, and launch rules.

## Theme and chrome

The package ships the `pi-workflow` theme and restyles Pi's terminal UI. The chrome patches Pi internals copied from Pi 1.0.4 without a version guard; re-verify them on every Pi upgrade. See [ADR 0007](docs/adr/0007-patch-pi-tui-internals-for-chrome.md).

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
- Pi CLI `>=1.0.4` available in the target environment
