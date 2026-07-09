# context-mode package patterns for pi-workflow

Source reviewed: <https://github.com/mksglu/context-mode> via local read-only clone at `/tmp/pi-github-repos/mksglu/context-mode`.

## Observed structure

`context-mode` is a full multi-client package, not only a Pi package. Its root contains platform-specific directories such as `.claude-plugin/`, `.codex-plugin/`, `.openclaw-plugin/`, `.pi/`, `configs/`, `hooks/`, `src/`, `tests/`, and `skills/`.

Relevant source evidence:

- Root `package.json` declares the npm package and its Pi resources.
- `.pi/extensions/context-mode/` contains the Pi-specific extension entry and local package metadata.
- `skills/` contains published skills such as `context-mode`, `ctx-doctor`, `ctx-index`, `ctx-search`, `ctx-stats`, `ctx-upgrade`, and related references.
- `tests/` is organized by domain (`tests/adapters`, `tests/core`, `tests/hooks`, `tests/session`, etc.).
- `.github/workflows/ci.yml` runs build/typecheck/tests across Ubuntu, macOS, and Windows.

## Package metadata and Pi manifest

The root `package.json` uses standard public npm metadata:

- `name`, `version`, `description`, `author`, `license`, `keywords`, `repository`, `homepage`, `bugs`.
- `keywords` includes `pi-package`, making the package discoverable as a Pi package.
- `files` explicitly controls what is published.
- `engines` pins the Node runtime expectation.

Its Pi manifest is explicit:

```json
"pi": {
  "extensions": ["./build/adapters/pi/extension.js"],
  "skills": ["./skills"]
}
```

For `@felipe.3dfx/pi-workflow`, the useful pattern is the explicit `pi` manifest and `pi-package` keyword. The build-heavy extension pattern does not apply to this small meta-configuration helper.

## Build, test, and release hygiene

`context-mode` uses scripts for build, bundle assertions, typechecking, tests, benchmarks, and prepublish:

- `prepublishOnly` runs `npm run build`.
- `test` runs `vitest run`.
- `typecheck` runs `tsc --noEmit`.
- CI runs install, typecheck, build, bundle, bundle invariant checks, and tests.
- `.npmignore` and `files` are both used to keep source/test/dev artifacts out of npm distribution.

For `@felipe.3dfx/pi-workflow`, most of this is intentionally too heavy for v1. The transferable subset is:

- use `files` in `package.json`;
- include `README.md` and `LICENSE` in published files;
- add a cheap validation script that inspects `package.json`, confirms local Pi resources exist, and rejects `node_modules` Pi manifest paths;
- use `prepublishOnly` to run that validation;
- keep companion package metadata in a local source-of-truth file.

## Documentation patterns

`README.md` is user-facing and starts with the problem, what the package solves, install instructions, verification commands, and platform-specific details.

`CONTRIBUTING.md` captures local development, architecture overview, build/test commands, TDD expectations, and PR expectations.

For `@felipe.3dfx/pi-workflow`, the useful documentation pattern is much smaller:

1. State what the package is and is not.
2. Show `pi install npm:@felipe.3dfx/pi-workflow`.
3. List companion third-party packages and point to the metadata source of truth for exact supported versions.
4. Explain that v1 exposes only its own helper extension and does not re-export dependency-provided resources.
5. Document the companion update policy.

## Practices to copy

- Explicit `pi` manifest instead of relying only on conventional discovery.
- `pi-package` keyword.
- Public npm metadata: repository, bugs, homepage, license, files.
- `files` whitelist for predictable package contents.
- `prepublishOnly` validation.
- README sections for install, contents, scope, verification, and update policy.
- Keep package behavior honest: `context-mode` states its routing/tool behavior directly; `pi-workflow` should state that v1 is a meta-configuration helper only.

## Practices not applicable to v1

- Build pipeline for TypeScript extension output: v1 should not include proprietary extension behavior.
- Large adapter/config matrix: v1 targets Pi package installation only.
- Runtime hooks, MCP server bundles, CLI binaries, SQLite/session architecture: those belong to the upstream companion packages, not this helper package.
- Vendoring upstream skill source into this repo: explicitly out of scope by project decision.

## Recommendation for @felipe.3dfx/pi-workflow

Use a minimal npm package with:

- `package.json` named `@felipe.3dfx/pi-workflow`.
- `private: false` or no `private` field.
- `keywords` including `pi-package`, `pi`, and workflow/distribution terms.
- exact companion versions in local metadata, not runtime `dependencies`.
- no `bundledDependencies` and no `pi` manifest paths into `node_modules/...`.
- a local helper extension that reports companion status and installs missing companions only after confirmation.
- README documenting install, companion packages, the companion metadata source of truth, and upgrade policy.
- a lightweight validation script to fail publication if a referenced resource path is missing.

## Important discovery for the current scope

The selected packages mostly expose Pi **extensions**, not only skills:

- `gentle-engram` exposes `pi.extensions` and no `pi.skills` in the reviewed npm metadata.
- `pi-mcp-adapter` exposes `pi.extensions` and no `pi.skills` in the reviewed npm metadata.
- `@tintinweb/pi-subagents` exposes `pi.extensions` and no `pi.skills` in the reviewed npm metadata.
- `pi-web-access` exposes both `pi.extensions` and `pi.skills` in the reviewed npm metadata.

That means a strict "skills only" aggregator would expose only `pi-web-access` skills and would omit the main capabilities of the selected packages. The project decision is to avoid aggregation entirely: `pi-workflow` exposes only its own helper extension, while these packages remain independently installed Pi companions. Exact current companion versions live only in `assets/companions.json`.
