# Archive Report: support-codegraph-companion

## Outcome

The `support-codegraph-companion` change has been archived successfully.

## Task Completion Gate

- `tasks.md`: 11/11 implementation tasks complete.
- `apply-progress.md`: confirms all implementation tasks complete.
- `verify-report.md`: PASS, no CRITICAL/WARNING/SUGGESTION findings.

## Spec Sync

- Synced delta spec into `openspec/specs/codegraph-companion-support/spec.md`.
- The main spec now reflects the final CodeGraph companion support behavior.

## Archived Artifacts

- `proposal.md`
- `specs/codegraph-companion-support/spec.md`
- `design.md`
- `tasks.md`
- `apply-progress.md`
- `verify-report.md`
- `exploration.md`

## Verification Summary

- `npm run check` passed.
- `npm pack --dry-run` passed.
- Review budget stayed within 400 lines: 293 changed lines.
- CodeGraph CLI readiness is documented as executing `codegraph` from `PATH`, not detecting an npm-global package.

## Engram Traceability

- proposal: #1702
- spec: #1704
- design: #1705
- tasks: #1707
- apply-progress: #1708
- verify-report: #1713
- supporting observations: #1709, #1710, #1712

## Notes

- Archive performed in hybrid mode, so the filesystem archive and Engram archive report were both updated.

## Post-Archive Hardening Addendum (2026-07-09)

- The original archive metrics are retained as historical evidence only.
- A later pre-commit hardening pass added `tsc --noEmit` to the active verification profile, added a focused-test guard to `npm run check`, and expanded behavior tests beyond the archived 16-test count.
- CodeGraph readiness semantics were tightened after archive: `.codegraph` must be a directory, and `/pi-workflow-doctor` now emits a warning level when CLI/index readiness is missing or degraded.
- The Pi `exec` CLI probe remains without an enforceable timeout because the current repository-local `ExtensionAPI.exec` contract exposes no timeout/cancellation option; a non-cancelling wrapper would be misleading, so this is an accepted documented limitation.
- Future reviewers should use current `npm run check` output for gate status and treat the 293-line/16-test/type-checker-unavailable values above as superseded archive-era evidence.
