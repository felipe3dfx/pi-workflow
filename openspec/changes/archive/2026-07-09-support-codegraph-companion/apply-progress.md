# Apply Progress: Support CodeGraph Companion

## Status

All implementation tasks are complete. Strict TDD mode was active for code and validator behavior changes.

## Completed Tasks

- [x] 1.1 Update `test/validate-pi-package.test.mjs` fixtures to expect `@vndv/pi-codegraph@0.1.10` and `engines.node === ">=22.19"`.
- [x] 1.2 Add failing `test/pi-workflow-companions.test.mjs` cases for CodeGraph missing, installed/available, CLI missing, index missing, and ready states.
- [x] 2.1 Add the pinned CodeGraph entry to `assets/companions.json` without changing existing companion entries.
- [x] 2.2 Raise `package.json` `engines.node` to `>=22.19`.
- [x] 2.3 Update `scripts/validate-pi-package.mjs` to require CodeGraph companion metadata and the `>=22.19` Node baseline.
- [x] 3.1 Refactor `extensions/pi-workflow.ts` companion status helpers to accept injectable package-resolution and diagnostic adapters.
- [x] 3.2 Add CodeGraph readiness helpers in `extensions/pi-workflow.ts` for companion state, `codegraph` CLI availability, and `${cwd}/.codegraph` index presence.
- [x] 3.3 Extend `/pi-workflow-status` output so missing CodeGraph appears recommended without implying auto-installation.
- [x] 3.4 Extend `/pi-workflow-doctor` output with separate CodeGraph companion, CLI, and project-index readiness guidance.
- [x] 4.1 Update `README.md` Node requirements to `>=22.19` wherever the supported baseline is documented.
- [x] 4.2 Add README setup guidance for installing the CodeGraph companion, making the CLI available, running explicit project indexing, and verifying with `/pi-workflow-doctor`.
- [x] 5.1 Run `npm run check` and fix test, lint, or package validation failures.
- [x] 5.2 Run `npm pack --dry-run` and confirm the publishable package includes the updated assets, extension, and README.

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 / 2.1 / 2.2 / 2.3 | `test/validate-pi-package.test.mjs` | Package validation | ✅ 4/4 baseline passing | ✅ Validator fixtures and lower-Node rejection failed before implementation | ✅ 5/5 after validator, companion metadata, and engine updates | ✅ Baseline pass plus missing CodeGraph and lower Node failure paths | ✅ Relevant validator test passed after metadata changes |
| 1.2 / 3.1 / 3.2 / 3.3 / 3.4 | `test/pi-workflow-companions.test.mjs` | Unit | ✅ 6/6 baseline passing | ✅ Missing exports and CodeGraph readiness cases failed before implementation | ✅ 11/11 after injectable status/readiness helpers | ✅ Missing, installed, CLI missing, index missing, and ready states covered | ✅ Relevant companion test passed after lint cleanup |
| 4.1 / 4.2 | README guidance | Documentation | N/A (docs) | ➖ Documentation-only task; behavior covered by validator and companion tests | ✅ `npm run check` and `npm pack --dry-run` include README in package | ➖ Single documentation flow | ✅ Pack output confirms README included |
| 5.1 | Full project check | Verification | N/A | N/A | ✅ `npm run check` passed | N/A | ✅ Biome warning fixed before final check |
| 5.2 | Pack dry run | Verification | N/A | N/A | ✅ `npm pack --dry-run` passed | N/A | ✅ Pack output includes assets, extension, and README |

## Test Summary

- **Total tests written**: 6
- **Total tests passing**: 16
- **Layers used**: Unit (11), package-validation (5)
- **Approval tests**: None — no behavior-preserving refactor task required approval tests beyond the existing safety net.
- **Pure functions created**: 1 (`getCodeGraphReadiness` helper with injected adapters)

## Verification

- `node --test test/validate-pi-package.test.mjs` — passed, 5/5 tests.
- `node --test test/pi-workflow-companions.test.mjs` — passed, 11/11 tests.
- `npm run check` — passed; Biome, package validation, node:test suite, and pack dry-run all succeeded.
- `npm pack --dry-run` — passed; tarball includes `README.md`, `assets/companions.json`, `extensions/pi-workflow.ts`, `package.json`, and `scripts/validate-pi-package.mjs`.

## Deviations from Design

None — implementation follows the design: CodeGraph remains an explicit companion, readiness checks are internal testable seams, and install flows do not run `codegraph init`.

## Issues Found

- Biome requested optional chaining in `getCodeGraphReadiness`; fixed before final verification.
