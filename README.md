# @felipe3dfx/pi-workflow

A public Pi meta-configuration package for the `pi-workflow` foundation setup.

This package exposes only its own Pi extension. Companion packages such as Engram, MCP adapter, subagents, and web access are installed explicitly as independent Pi packages so their ownership, updates, and resources stay transparent.

## Install

Install the meta package:

```bash
pi install npm:@felipe3dfx/pi-workflow
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

## Companion packages

Companion package names and pinned versions are defined in [`assets/companions.json`](assets/companions.json), which is the single source of truth. Updating a companion version is a repository change and should be reviewed like any other supported workflow change.

Configured companions:

| Package | Pinned version |
| --- | --- |
| `gentle-engram` | `0.1.10` |
| `pi-mcp-adapter` | `2.11.0` |
| `@tintinweb/pi-subagents` | `0.13.0` |
| `pi-web-access` | `0.13.0` |

## Scope

In scope:

- one local `pi-workflow` helper extension;
- status and doctor commands for configured companions;
- explicit companion installation after user confirmation;
- exact companion versions controlled by this repository;
- install and update documentation.

Out of scope:

- bundling third-party Pi package source;
- re-exporting third-party extensions or skills through this package manifest;
- silently installing companion packages;
- proprietary company workflow behavior;
- automatic companion upgrades.

## Package design

Pi packages declare resources in `package.json` using the `pi` manifest. This package keeps that manifest intentionally small:

```json
{
  "pi": {
    "extensions": ["./extensions/pi-workflow.ts"]
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

The release guard validates that:

- the package name and public publish config are correct;
- `pi-package` is present in keywords;
- only the local `pi-workflow` extension is exposed;
- no Pi manifest paths point into `node_modules`;
- no `bundledDependencies` or `bundleDependencies` field exists;
- companion metadata includes the expected packages and versions;
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
