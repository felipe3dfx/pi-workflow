# Exploration: support-codegraph-companion

### Current State
`pi-workflow` is a meta-configuration package with one local extension and explicitly installed companion packages. The extension reads `assets/companions.json`, reports install/version state, and can prompt or run `pi install npm:<pkg>@<version>` for missing or mismatched companions. Validation and tests treat `assets/companions.json` as the source of truth.

`@vndv/pi-codegraph` is upstream Pi extension tooling for CodeGraph. Its README says it is installed as a Pi package, requires Node.js 22.19.0+, requires the `@colbymchenry/codegraph` CLI on `PATH`, and needs `codegraph init -i` per project before use.

### Affected Areas
- `assets/companions.json` — add the pinned CodeGraph companion entry.
- `README.md` — document the new companion and update the companion table / install guidance.
- `scripts/validate-pi-package.mjs` — keep the allowlist and metadata checks aligned with the new companion.
- `test/pi-workflow-companions.test.mjs` — update companion fixture expectations and install instruction assertions.
- `extensions/pi-workflow.ts` — only needs changes if we decide to add a deeper diagnostic seam beyond package-install status.

### Approaches
1. **Metadata-only companion entry** — add `@vndv/pi-codegraph@0.1.10` to the companion list and keep diagnostics at package-install level.
   - Pros: matches current architecture, small surface area, no new runtime coupling, easy to test.
   - Cons: does not verify CLI availability or project index readiness.
   - Effort: Low

2. **Metadata plus runtime readiness checks** — add the companion entry and extend the extension to inspect CodeGraph CLI/index readiness.
   - Pros: better user guidance for the full CodeGraph workflow.
   - Cons: expands the seam, introduces environment-specific checks, and likely needs a project-path-aware design.
   - Effort: Medium/High

### Recommendation
Use the metadata-only companion path first. It fits the existing Pi companion model and keeps `pi-workflow` focused on explicit package installation. If readiness checks are needed later, add them as a separate project-aware diagnostic seam instead of mixing them into the current companion status flow.

### Risks
- The Pi install can succeed while CodeGraph still fails if the CLI is missing or the project is not initialized.
- `@vndv/pi-codegraph` has a stricter Node floor than the current package baseline, so docs should call that out explicitly.
- Validation must keep treating `assets/companions.json` as the single source of truth; duplicating versions elsewhere will drift.

### Ready for Proposal
Yes — the next step can be a small companion metadata + docs + test proposal, with runtime readiness diagnostics deferred unless the user wants that extra seam.
