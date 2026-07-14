# @felipe.3dfx/pi-workflow

A public Pi meta-configuration package for the `pi-workflow` foundation setup.

This package exposes its own Pi extension plus four native workflow skills and four homonymous prompt templates. Companion packages such as Engram, MCP adapter, subagents, web access, and CodeGraph are installed explicitly as independent Pi packages so their ownership, updates, and resources stay transparent.

## Public workflow boundary

`/define-product`, `/deliver-ticket`, `/qa-handoff`, `/product-review`, and their matching `/skill:<name>` forms are admitted only from idle interactive Pi input. RPC, extension, steering, follow-up, and reentrant invocations are blocked before prompt or skill expansion. While an admitted public-entry turn is pending, the extension blocks every tool call; later workflow modules must enforce authority before any mutation.

Owner approval uses launch-host configuration, not model/tool arguments. Start Pi with exact non-empty `PI_WORKFLOW_OWNER_ACTOR_ID` and `PI_WORKFLOW_OWNER_AUTHORITY_REVISION` environment values; the packaged extension snapshots them as the current `Owner` authority when it initializes. The role is fixed by the extension and cannot be supplied by the caller. Missing values, surrounding whitespace, or incomplete configuration fail closed and cannot approve a Spec. Rotate the authority revision whenever the host's Owner authorization changes.

This seam trusts the process launcher to authenticate and configure the Owner; it does not infer a human role from conversational text. QA and PS remain organizational/Linear roles outside this runtime authority seam.

The `to-spec` agent brief requires every Linear-facing field and the final body to use neutral professional Spanish while preserving stable identifiers exactly. The runtime records the exact `language: "es"` contract but deliberately does not use NLP, dictionaries, or regionalism heuristics to judge prose style. Publication instead requires trusted Owner approval bound to the exact Spec digest; translation or any other body change after approval requires a new digest and approval.

## Requirements

- Node.js `>=22.19`
- Pi CLI available in the target environment
- Optional CodeGraph readiness requires the `codegraph` CLI on `PATH` and a project `.codegraph/` index

## Install

Install the meta package:

```bash
pi install npm:@felipe.3dfx/pi-workflow
```

Reload Pi so the local helper commands are available:

```text
/reload
```

Inspect companion package status:

```text
/pi-workflow-status
/pi-workflow-doctor
```

Install missing companions after reviewing the confirmation prompt:

```text
/pi-workflow-install-companions
```

Then reload Pi again so companion resources are loaded:

```text
/reload
```

In non-UI contexts, the install command prints the exact `pi install npm:<pkg>@<version>` commands instead of installing automatically.

### Agent asset inspection and planning

The packaged CLI previews the agent assets managed by `pi-workflow`:

```bash
pi-workflow-sync inspect
pi-workflow-sync plan
```

Both commands are strictly read-only and return JSON with `mutation: "none"`; they never create, replace, migrate, or delete files. `inspect` reports ownership and drift. `plan` translates that snapshot into proposed `create`, `replace`, or `migrate` actions. A `refusal` means planning detected managed drift, an unmanaged collision, or a newer installed version and will not propose an unsafe mutation. Follow the returned diagnostic/remediation—normally back up or move the named file, repair/remove a malformed manifest, fix permissions, reinstall a damaged package, or upgrade `pi-workflow`—then rerun the command.

Inspection digests bind the exact catalog, manifest identity/content, packaged sources, and observed existence/content digest of every target. Plan digests include that inspection digest, so a changed managed predecessor produces a different preview and must be replanned. Canonical ordering keeps unchanged snapshots deterministic.

Interrupting either command cancels the preview, returns no usable assets/actions, performs zero writes, and exits with status `130`. Blocked/refused previews exit `1`; successful read-only previews exit `0`; invalid CLI usage exits `2`.

Applying a plan is intentionally out of scope for T03 and is not implemented by this CLI.

### MCP setup

The companion install flow also manages the Pi MCP catalog from [`assets/mcp-servers.json`](assets/mcp-servers.json).

- It writes only `${PI_CODING_AGENT_DIR:-${PI_AGENT_HOME:-~/.pi/agent}}/mcp.json`.
- It preserves unrelated top-level fields and unrelated MCP servers.
- After confirmation it re-reads the latest config before writing; if a targeted `context7`, `sentry`, or `linear` entry changed after preview, the command stops and asks you to rerun against the latest file.
- Exact `context7`, `sentry`, and `linear` entries are previewed before confirmation; malformed JSON or write failures are reported with the target path and manual recovery guidance.
- The flow never performs MCP authentication. After a successful install, run `/reload` and follow any Sentry or Linear OAuth prompts in Pi if those servers need them.
- Exact catalog contents are validated by `npm run check:publish`.

### CodeGraph setup

CodeGraph support has three separate readiness checks:

1. Install the recommended companion package through the normal companion flow:

   ```text
   /pi-workflow-install-companions
   ```

   Or install it manually when needed:

   ```bash
   pi install npm:@vndv/pi-codegraph@0.1.10
   ```

2. Make the `codegraph` CLI available on `PATH`. `pi-workflow` validates readiness by checking whether the `codegraph` command can be executed, not by checking for a globally installed npm package. This keeps the check package-manager agnostic for users who install CodeGraph with npm, pnpm, Homebrew, mise, a system package, or another tool.

   The companion package and CLI readiness are reported separately; installing the companion does not imply the CLI is usable.

3. Initialize the current project index explicitly from the project root:

   ```bash
   codegraph init <project-root>
   ```

Verify readiness after reloading Pi:

```text
/reload
/pi-workflow-doctor
```

The doctor reports the CodeGraph companion package, CLI availability, and `.codegraph/` index state independently. `pi-workflow` never runs `codegraph init` automatically.

## Companion packages

Companion package names and pinned versions are defined in [`assets/companions.json`](assets/companions.json), which is the single source of truth. Updating a companion version is a repository change and should be reviewed like any other supported workflow change.

Configured companions:

| Package | Pinned version |
| --- | --- |
| `gentle-engram` | `0.1.10` |
| `pi-mcp-adapter` | `2.11.0` |
| `@tintinweb/pi-subagents` | `0.13.0` |
| `pi-web-access` | `0.13.0` |
| `@vndv/pi-codegraph` | `0.1.10` |

## Scope

In scope:

- one local `pi-workflow` helper extension;
- four public workflow skills and four thin homonymous prompt templates;
- status and doctor commands for configured companions;
- CodeGraph companion, CLI, and project-index readiness diagnostics;
- explicit companion installation after user confirmation;
- exact companion versions controlled by this repository;
- deterministic generation of public skills and prompts from `scripts/public-workflow-catalog.mjs`;
- install and update documentation.

Out of scope:

- bundling third-party Pi package source;
- re-exporting third-party extensions or skills through this package manifest;
- silently installing companion packages;
- automatically initializing CodeGraph indexes;
- proprietary company workflow behavior;
- automatic companion upgrades;
- applying `pi-workflow-sync` plans (T03 remains read-only inspect/plan only).

## Package design

Pi packages declare resources in `package.json` using the `pi` manifest. This package keeps one thin extension entrypoint and exposes only package-owned public resources:

```json
{
  "pi": {
    "extensions": ["./extensions/pi-workflow.ts"],
    "skills": ["./skills"],
    "prompts": ["./prompts"]
  }
}
```

Third-party packages are not runtime `dependencies` of this package because Pi installs them independently with `pi install`. The source of truth for companion names and versions is `assets/companions.json`.

## Validation

Refresh the lockfile without running lifecycle scripts, then run the release guard:

```bash
npm install --package-lock-only --ignore-scripts
npm run check
```

Public workflow assets are human-readable generated files. Edit `scripts/public-workflow-catalog.mjs`, then run `npm run generate:public-workflows`; `npm run check` fails if generated resources are stale.

The release guard validates that:

- the package name and public publish config are correct;
- `pi-package` is present in keywords;
- only the local `pi-workflow` extension is exposed;
- exactly four homonymous workflow skills and prompt templates are exposed;
- prompt templates contain only exact skill loading and argument forwarding;
- public workflow resources exactly match the authoritative catalog;
- no Pi manifest paths point into `node_modules`;
- no `bundledDependencies` or `bundleDependencies` field exists;
- companion metadata includes the expected packages and versions;
- package metadata declares Node.js `>=22.19`;
- package scripts and release basics remain present;
- `npm pack --dry-run` succeeds.

## Companion update policy

To update a companion:

1. Change the version in `assets/companions.json`.
2. Run `npm install --package-lock-only --ignore-scripts` if package metadata changed.
3. Run `npm run check`.
4. Review the upstream package changelog/source for new resources or behavior.
5. Update this README's companion table.
6. Open a GitHub release for the new version.
7. Let `.github/workflows/publish.yml` publish to npm with provenance.

## Release CI/CD

CI runs on pushes and pull requests to `main` via `.github/workflows/ci.yml`.
Publishing runs only when a GitHub release is published via `.github/workflows/publish.yml`.

The publish workflow uses npm provenance and requires the GitHub environment named `npm`.
Configure that environment with the npm publishing token/secrets required by the repository before the first release.

## Research notes

The initial package shape was informed by reviewing `context-mode` as a mature Pi package example. The project later chose the explicit meta-configuration model documented here. See:

- [`docs/research/context-mode-package-patterns.md`](docs/research/context-mode-package-patterns.md)
