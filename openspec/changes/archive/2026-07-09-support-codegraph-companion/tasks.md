# Tasks: Support CodeGraph Companion

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 320-420 |
| 400-line budget risk | Medium |
| Chained PRs recommended | No |
| Suggested split | Single PR with work-unit commits |
| Delivery strategy | auto-forecast |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Add CodeGraph companion metadata and validation baseline | PR 1 | Keep package metadata tests with validator changes. |
| 2 | Add status/doctor readiness seams and scenarios | PR 1 | Keep extension tests with behavior changes. |
| 3 | Document setup and verification flow | PR 1 | README changes ship with user-visible diagnostics. |

## Phase 1: RED Tests and Fixtures

- [x] 1.1 Update `test/validate-pi-package.test.mjs` fixtures to expect `@vndv/pi-codegraph@0.1.10` and `engines.node === ">=22.19"`.
- [x] 1.2 Add failing `test/pi-workflow-companions.test.mjs` cases for CodeGraph missing, installed/available, CLI missing, index missing, and ready states.

## Phase 2: Metadata and Validation

- [x] 2.1 Add the pinned CodeGraph entry to `assets/companions.json` without changing existing companion entries.
- [x] 2.2 Raise `package.json` `engines.node` to `>=22.19`.
- [x] 2.3 Update `scripts/validate-pi-package.mjs` to require CodeGraph companion metadata and the `>=22.19` Node baseline.

## Phase 3: Extension Diagnostics

- [x] 3.1 Refactor `extensions/pi-workflow.ts` companion status helpers to accept injectable package-resolution and diagnostic adapters.
- [x] 3.2 Add CodeGraph readiness helpers in `extensions/pi-workflow.ts` for companion state, `codegraph` CLI availability, and `${cwd}/.codegraph` index presence.
- [x] 3.3 Extend `/pi-workflow-status` output so missing CodeGraph appears recommended without implying auto-installation.
- [x] 3.4 Extend `/pi-workflow-doctor` output with separate CodeGraph companion, CLI, and project-index readiness guidance.

## Phase 4: Documentation

- [x] 4.1 Update `README.md` Node requirements to `>=22.19` wherever the supported baseline is documented.
- [x] 4.2 Add README setup guidance for installing the CodeGraph companion, making the CLI available, running explicit project indexing, and verifying with `/pi-workflow-doctor`.

## Phase 5: Verification

- [x] 5.1 Run `npm run check` and fix test, lint, or package validation failures.
- [x] 5.2 Run `npm pack --dry-run` and confirm the publishable package includes the updated assets, extension, and README.
