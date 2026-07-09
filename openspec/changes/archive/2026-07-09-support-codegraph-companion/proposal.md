# Proposal: Support CodeGraph Companion

## Intent

Add CodeGraph as a first-class, recommended companion so users can see its status, understand readiness gaps, and set it up from the main README instead of discovering failures late.

## Scope

### In Scope
- Add `@vndv/pi-codegraph` to `assets/companions.json` and surface it in companion status.
- Extend `pi-workflow-doctor` with readiness diagnostics for CodeGraph CLI availability and project index readiness.
- Move the setup guide into `README.md` and raise the package baseline to `node >=22.19`.

### Out of Scope
- Bundling CodeGraph or auto-installing it without user confirmation.
- Reworking the existing companion installation model.
- Adding broader project analysis beyond CodeGraph readiness checks.

## Capabilities

### New Capabilities
- `codegraph-companion-support`: package metadata, status/doctor reporting, CLI/index readiness diagnostics, and README setup guidance for CodeGraph.

### Modified Capabilities
- None.

## Approach

- Keep the current explicit companion seam, but make CodeGraph the recommended companion when missing.
- Add environment-aware checks for `codegraph` on `PATH` and `codegraph init -i` / project-index readiness in doctor output.
- Treat `node >=22.19` as the project baseline so the docs and package metadata match upstream requirements.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `assets/companions.json` | Modified | Add pinned CodeGraph companion entry. |
| `extensions/pi-workflow.ts` | Modified | Surface CodeGraph status and readiness diagnostics. |
| `README.md` | Modified | Add setup guide and recommended companion flow. |
| `package.json` | Modified | Raise Node engine floor to `>=22.19`. |
| `scripts/validate-pi-package.mjs` | Modified | Keep validation aligned with the new companion and baseline. |
| `test/pi-workflow-companions.test.mjs` | Modified | Update expectations for status/doctor output and fixture metadata. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Added diagnostics become environment-specific noise | Medium | Keep checks read-only and phrase output as readiness guidance. |
| Node floor blocks older local installs | Medium | Document the new minimum in README and package metadata together. |

## Rollback Plan

Remove the CodeGraph companion entry, revert README/package engine changes, and restore the previous status/doctor behavior. Existing companions remain unchanged.

## Dependencies

- `@vndv/pi-codegraph`
- `@colbymchenry/codegraph` CLI on `PATH`

## Success Criteria

- [ ] Status shows CodeGraph as the recommended companion when missing.
- [ ] Doctor reports CLI and project-index readiness for CodeGraph.
- [ ] README documents the setup flow in the main install guide.
- [ ] `npm run check` and package validation still pass with the new baseline.
