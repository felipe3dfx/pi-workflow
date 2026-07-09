# Design: Support CodeGraph Companion

## Technical Approach

Keep `pi-workflow` as a small Pi extension whose external interface remains the existing three commands: `/pi-workflow-status`, `/pi-workflow-doctor`, and `/pi-workflow-install-companions`. Add CodeGraph through the existing companion metadata seam, then deepen the extension internally by routing doctor-only readiness checks through small diagnostic functions/adapters. This satisfies the spec without bundling CodeGraph or making companion package status imply CLI/index readiness.

## Architecture Decisions

| Decision | Choice | Alternatives considered | Rationale |
| --- | --- | --- | --- |
| Companion support seam | Add `@vndv/pi-codegraph@0.1.10` to `assets/companions.json` and validator expectations. | Add it as an npm dependency or Pi manifest extension. | The project already treats companions as explicit user-installed packages; metadata preserves ownership and rollback locality. |
| External Pi interface | Keep current commands and enrich doctor/status content only. | Add a CodeGraph-specific command. | A smaller interface gives users one diagnostic entrypoint and avoids shallow command proliferation. |
| Diagnostic depth | Add internal readiness helpers for package, CLI, and index state. | Inline checks inside `showCompanionDoctor`. | Internal seams keep behavior testable while hiding environment complexity from callers. |
| Readiness semantics | Report companion package status separately from `codegraph` CLI availability and `.codegraph/` project index presence. | Collapse all states into installed/missing. | Package installation is not readiness; conflating them would produce misleading status. |
| Node baseline | Align package metadata, README, tests, and validator on `>=22.19`. | Leave `>=22` and document exceptions. | A single enforced baseline prevents docs/package drift and catches regressions in validation. |

## Data Flow

```text
Pi command
  └─ companionStatusLines({ diagnostic })
       ├─ loadCompanions() ── assets/companions.json
       ├─ getCompanionState() ── package resolution adapter
       └─ if doctor: getCodeGraphReadiness() ── diagnostic adapters
              ├─ command availability: codegraph --version or PATH lookup
              └─ project index: cwd/.codegraph directory check
```

## File Changes

| File | Action | Description |
| --- | --- | --- |
| `assets/companions.json` | Modify | Add pinned `@vndv/pi-codegraph@0.1.10` with a clear description. |
| `extensions/pi-workflow.ts` | Modify | Add CodeGraph metadata detection, doctor readiness lines, and injectable internal adapters for command/index checks. |
| `scripts/validate-pi-package.mjs` | Modify | Require CodeGraph companion metadata and `engines.node === ">=22.19"`. |
| `test/pi-workflow-companions.test.mjs` | Modify | Cover CodeGraph recommended/missing output and doctor readiness states via injected seams. |
| `test/validate-pi-package.test.mjs` | Modify | Update fixtures for CodeGraph and Node baseline validation. |
| `package.json` | Modify | Raise `engines.node` to `>=22.19`. |
| `README.md` | Modify | Document Node baseline, CodeGraph companion setup, CLI prerequisite, indexing, and readiness verification. |

## Interfaces / Contracts

No new public Pi command is added. Internally, prefer small functions with injected dependencies:

```ts
type DiagnosticAdapters = {
	exec: ExtensionAPI["exec"];
	cwd: () => string;
	pathExists: (path: string) => Promise<boolean> | boolean;
};

type CodeGraphReadiness = {
	companion: CompanionState | undefined;
	cli: "available" | "missing" | "error";
	index: "present" | "missing" | "unknown";
	messages: string[];
};
```

`pi-workflow-status` may mark CodeGraph as recommended/missing through companion status. `pi-workflow-doctor` MUST add readiness lines for CLI and project index. Install flows remain package-only and MUST NOT run `codegraph init`.

## Testing Strategy

| Layer | What to Test | Approach |
| --- | --- | --- |
| Unit | Companion metadata, CodeGraph recommended status, CLI/index readiness formatting. | `node:test` with fake package resolver and diagnostic adapters. |
| Package validation | Required companions and Node baseline. | Fixture-based validator tests for pass/fail cases. |
| Pack/check | Publishable package shape. | Existing `npm run check` and `npm pack --dry-run`. |

## Migration / Rollout

No data migration required. This is a metadata, diagnostics, documentation, and package-baseline change. Rollback removes the CodeGraph companion entry, readiness helpers, README section, and Node baseline validator update.

## Open Questions

- [ ] None.

## Post-Archive Hardening Addendum (2026-07-09)

- `.codegraph` readiness now treats the index as present only when `.codegraph` is a directory, matching the README/spec contract and avoiding false readiness from a regular file at that path.
- `/pi-workflow-doctor` notification severity now degrades to `warning` when CodeGraph CLI readiness or project index readiness is missing/degraded, so the user-facing level matches the readiness detail lines.
- `pi.exec("codegraph", ["--version"])` remains the Pi execution seam for CLI probing. The current extension API type used by this repository exposes only `(command, args) => Promise<{ code, stdout, stderr }>` and no cancellation/timeout option; adding `Promise.race` would not cancel the underlying process, so this is documented as an accepted limitation rather than a fake timeout.
- The verification gate now includes `npm run check:focused-tests`, backed by `scripts/forbid-focused-tests.mjs`, to prevent committed `test.only`, `describe.only`, `it.only`, or `suite.only` markers from bypassing `node --test`.
