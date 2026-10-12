# Claude Bridge support

**Status:** English technical specification; **READY WITH WARNINGS**. Publication verification is tracked by the parent issue. No implementation is authorized by this artifact.
**Definition:** `claude-bridge-support/definition-1`
**Review:** `claude-bridge-support/feature-review-1`; **READY WITH WARNINGS**.
**Parent:** [#238](https://github.com/felipe3dfx/pi-workflow/issues/238).
**Business intent:** The developer’s approved brief. It does not change canonical terminology in `GLOSSARY.md`.

## Problem and solution

The operator wants Claude Bridge models in the parent and all three Specialists without replacing the harness’s delegation, Contracts, tools, or lifecycle. Pi’s stock child factory rejects Bridge requests at prompt capture. Use the official installed Bridge extension through Pi’s public child lifecycle and resource loader, preserving the existing child-session path.

For children explicitly selected to use Bridge, discover the official installed provider package through Pi’s package-management/trust facilities and load only its applicable extension resource through the public `additionalExtensionPaths` mechanism. Do not load Bridge for children whose selected model is not Bridge. Keep the existing model runtime, Contract, context, tool projection, lifecycle, and result paths.

## User stories

- As an operator, I can select a Bridge model in the parent or a Specialist Model profile.
- As an operator, an unavailable explicitly selected model is refused before launch with an actionable diagnostic and no fallback.
- As an operator, each child receives its own Contract and permitted context—not parent-only delegation instructions—before its first request.
- As an operator, provider, authentication, installation, or prompt errors remain visible; the harness does not install software or silently choose another model.
- As an operator, results, Steer, cooperative cancellation, Run states, and completed-child continuation retain existing behavior.

## Structural decisions

Each choice includes evidence, reason, and necessity. **Mandatory** means an accepted decision, contract, authority, or indispensable dependency requires it. A **Recommendation** is replaceable if mandatory behavior is preserved.

| Decision | Classification, resolver, source, status | Evidence, reason, necessity |
|---|---|---|
| Support Bridge in parent and Explorer, Worker, Verifier; use the official Bridge extension through Pi’s public child lifecycle. | **Mandatory.** Developer; approved brief and consolidated review; accepted, no supersession. | Approved scope and selected path. |
| Resolve the actual installed provider using Pi’s package identity, configured-source, trust, and installed-path APIs; supply the selected public extension resource through `additionalExtensionPaths`. | **Recommendation.** Developer selected the public official-loader path; approved brief/review plus Pi 1.0.4/1.1 declarations and `docs/packages.md`. | Pi exposes the relevant loader and package APIs. This avoids reflection, a new upstream API, and manually duplicating package identity/trust resolution. Use only the selected official resource, not unrelated extensions. |
| Keep implementation of the small package-resolution helper local to the existing child-session loader seam. | **Recommendation.** Current `extensions/child-sessions.ts`, `extensions/web-access.ts`, and Pi package APIs. | Existing seam creates the resource loader and session. `web-access.ts` already uses `DefaultPackageManager` with parent trust and project-first/user-scope lookup. A separate package framework or mandatory vendored manifest parser is not justified unless SDK behavior proves insufficient. |
| Do not load Bridge for a child unless its selected model is Bridge. | **Mandatory.** Minimal scope of approved Bridge support; approved brief. | Preserves non-Bridge extension/tool behavior and avoids loading an unrelated provider. |
| Preserve catalog validation, model/thinking inheritance, and refusal for an unavailable explicit model before launch; no fallback. | **Mandatory.** Developer; approved brief and review, statuses closed by approval. | Existing profile semantics remain authoritative; catalog refusal is approved and fallback is excluded. |
| Preserve role Contracts, role context/tool projections, result delivery, Steer, cancellation, and continuation. | **Mandatory.** Developer; approved scenarios, ADR 0010/0014, existing source/specs. | These are shared child-session invariants, not Bridge-specific behavior. |
| Do not change the current Pi peer range. Require version/model coverage as delivery criteria. | **Mandatory.** Current task constraint and `package.json` (the three Pi peers are `>=1.0.4`); preserve demonstrated existing consumers. | Prototype evidence covers one model/version combination, not universal support. No unasked peer-range change. |
| No AskClaude, automatic install, global settings/auth changes, Bridge source bundling, new delegation tool/runtime, parent-prompt inheritance, capture bypass/mutation, private cache cleanup, or cancellation mitigation. | **Mandatory.** Developer; approved brief and explicit constraints. | Explicit exclusions and accepted cancellation/cache risks. |
| Companion catalog adoption only after production proof. | **Mandatory.** Developer; approved brief/review and ADR 0001/0005. | Prototype alone is insufficient evidence. |
| ADR 0014 amendment required before delivery; do not edit it during planning. | **Mandatory.** Developer; consolidated review and ADR 0014. | Current curated extension list does not yet authorize Bridge. This is not a planning prerequisite. |
| Prototype is reference-only; no UI contract. | **Mandatory.** Developer; approved brief/review. | Confirmed disposition; feature is nonvisual. |

### Provider discovery and loading contract

Use the parent project’s cwd and trust decision for package resolution; never read the child worktree’s package configuration. Respect Pi’s configured scope, source identity, and resource filters. Pi documentation identifies npm by package name, git by normalized repository identity, and local packages by resolved absolute path; do not assume npm-only installation. Do not invent support for temporary CLI packages without parent metadata establishing their identity.

Recommended adapter: use Pi’s public `DefaultPackageManager` facilities, including `getInstalledPath(source, scope)` and configured-package inventory, to identify the official provider package and installed path. The helper/API arrangement remains a recommendation; installed-only discovery, trust, filtering, and official-resource identity are mandatory. Any configured-package `resolve` call must supply a non-installing `onMissing` policy. Do not use installing `resolve()` defaults or `resolveExtensionSources` to fetch a provider. Follow Pi’s project-trust behavior: trusted project configuration may supply the project-scoped package; otherwise use the user scope. Preserve Pi’s project/package precedence and filters. Use `DefaultResourceLoaderOptions.additionalExtensionPaths` with the verified absolute installed extension file, never an npm/git package source, while retaining the child's in-memory curated settings. Do not substitute parent package settings into the child loader. This loads the selected official extension resource without broadening the current curated loader configuration. Verify that the installed Pi version applies this path as intended alongside the current child loader options, including `noExtensions: true`; do not silently broaden extension loading if it does not.

The official package identity and exact extension resource must come from actual installed provider metadata/runtime evidence, not a guessed package slug. Match the package/provider identity and selected resource explicitly. Do not load unrelated extensions from the same package. Pi 1.0.4 and 1.1 declarations establish these public facilities; supported-version behavior and resource selection remain delivery tests.

Missing, unreadable, unresolvable, ambiguous, filtered-out, or invalid official provider installation is an explicit launch/provider failure; do not auto-install, load another provider, or fallback. An unavailable explicitly selected catalog model is refused **before launch**. Other installed-path/resource startup failures must be reported honestly through existing failure/diagnostic paths; do not promise every such failure is a pre-launch refusal.

Do not claim that the official extension never writes provider-owned runtime state. Observe and minimize integration effects; do not change Bridge internals or perform unapproved setup/configuration/auth changes.

## Observable sequence and states

1. Existing launcher validates role, Contract, profile/model/thinking pair, and worktree under current rules.
2. An explicitly selected model absent from the Pi model catalog is refused before launch with an actionable diagnostic; no fallback.
3. For a Bridge-selected child, resolve the official installed package/resource with parent cwd/trust and applicable Pi scope/filter rules. A missing or invalid installation fails honestly without installation or fallback.
4. Configure and reload the curated child resource loader, including the verified installed Bridge extension path when selected. Extension loading precedes session creation. Prepare the child's Contract and role-permitted context; do not inherit parent-only instructions.
5. Create the child session through the existing factory seam. Inside its run, bind/start extensions before the first prompt and provider request, preserving existing ordering.
6. Provider, authentication, prompt, or extension-start failures surface as the current refusal/failure state and diagnostics. Do not report success or choose another model.
7. Preserve existing Run-state, result, Steer, cancellation, shutdown, and continuation transitions. F1’s accepted history rebuild/cache cost remains; no cache cleanup or module-isolation workaround is introduced.

## Shared capability invariants

- Existing Model profiles/catalog validation and model/thinking inheritance are unchanged.
- Bridge is loaded only for a Bridge-selected model; other children keep existing extension/tool behavior.
- Explorer has no repository context; Worker and Verifier retain theirs. Contract takes precedence over permitted context.
- Existing role tool projections, nested codemode, `ask_parent`, `report_result`, result delivery, Steer, cancellation, and continuation remain unchanged.
- The harness extension is not loaded in children; no recursion/delegation tool is added.
- Parent trust is not broadened; child worktree configuration is not read for provider discovery.
- No auto-install, source bundling, settings/auth changes, silent fallback, or OS-isolation claim.
- Fixture/runtime security and cooperative-cancellation limits remain.

## Testing and delivery criteria

Tests should exercise real public seams and the actual installed provider resource, not only fakes. Existing public APIs must be verified on supported Pi versions before delivery.

| Coverage | Required behavior |
|---|---|
| Four roles | Bridge works in parent and each of Explorer, Worker, Verifier; role Contract/context/tools and model/thinking are correct. |
| Native-profile regressions | Non-Bridge children do not load Bridge and retain current extension/tool behavior. Mixed Bridge/native parent and child profiles select the correct provider per session. |
| Model availability | Explicit unavailable model refuses before launch with no fallback; existing profile validation and inheritance remain unchanged. |
| Package resolution | Actual official package identity/resource is recognized for npm, git, and local configured installs where supported; user/project precedence, project trust, source filters, and parent cwd are honored. No child-worktree config or unrelated extension is loaded. |
| Failure paths | Missing, unreadable, ambiguous, filtered, unresolvable, and invalid extension resource produce visible failures without install or fallback. Provider/auth/prompt failures are honest. |
| Lifecycle/module cache | Extension load and bind precede first request; shutdown/reload and same-CWD/cross-worktree behavior use the accepted official path. No unintended history mixing/errors in tested flows. |
| F1 accepted cost | Idle-parent history rebuild and concurrent parent/sibling/target-child behavior preserve the tested session markers and avoid observed mixing/errors. A history rebuild is acceptable; tests must not require preventing it. The accepted, unquantified replay/cache cost remains documented. |
| Shared child behavior | Results, full-parent result wake/delivery behavior, Steer, cooperative cancellation, terminal states, and completed-child continuation with saved conversation remain unchanged; failed/cancelled/timed-out continuation remains refused. |
| Existing integrations | Late MCP declaration/refreshed tool section and optional web behavior preserve current Pi/harness behavior and do not broaden trust. Missing optional web installation remains nonfatal and Explorer-only. |

Supported Pi/model/version coverage is a delivery criterion; do not change the peer range to meet it without a separate decision. Production integration and actual installed-provider resolution are not proven by the scratch prototype. ADR 0014 amendment is required before delivery; catalog adoption waits for production proof.

## Dependencies, risks, and prototype

**Dependencies:** official Bridge provider independently installed and registered; Pi’s public child resource-loader/package-manager APIs; existing child-session factory, launcher, profiles, Contracts, and lifecycle.

**Accepted risks/evidence:**

- F1: official Bridge module shutdown clears module-shared sessions/history mirrors and global active-stream guard. Reverified public-session probes found no functional mixing/error in tested flows. Idle-parent history rebuild and unquantified replay/cache cost are explicitly accepted without mitigation. Probes are not full production-manager/MCP/web integration.
- Cancellation remains cooperative. A cancelled session may retain an unmatched tool call and stale-context warning; the baseline also occurs without Bridge. Universal post-cancel process cleanup is unproven.
- Existing upstream prompt/cache behavior remains; up to 256 lookup keys and possible retained inheritance references are accepted. No unbounded leak was demonstrated. No private cleanup.
- Children share the parent’s in-process access; fixture/runtime security and cancellation limits remain. No OS isolation.
- Prototype evidence is limited to Pi 1.1.0, Bridge 0.9.2, Claude Code 2.1.296, Haiku 4.5-low and scratch adaptation. Production integration and broader model/version support remain unproven.
- Historical quality evidence: a completed `npm run check` recorded 823 passed, 31 failed, and 1 skipped after 1Password fixture-commit errors; a later attempt timed out after 120 seconds. Publication validation subsequently passed the complete `npm run check` in 16.1 seconds: 855 tests, 854 passed, 0 failed, 1 skipped, and packed distribution validation passed. Signing configuration was not changed or bypassed. This validates the documentation candidate, not production Bridge support.

Prototype disposition: **reference-only, confirmed**. No durable prototype branch/commit. No UI contract.

## Publication package and current inventory

The stable brief for joint feature-review publication remains the exact approved English capture. It is paired with a Spanish feature-review report. The English specification is paired with a Spanish consolidated readiness/review report. These are two separate publication pairs; the four package artifacts are:

- Joint feature-review brief: [docs/features/claude-bridge-support.md](../features/claude-bridge-support.md).
- Joint feature-review report: [docs/features/claude-bridge-support-review.md](../features/claude-bridge-support-review.md).
- English specification: [docs/specs/claude-bridge-support.md](claude-bridge-support.md).
- Consolidated report: [docs/specs/claude-bridge-support-review.md](claude-bridge-support-review.md).

Parent issue: [#238](https://github.com/felipe3dfx/pi-workflow/issues/238); its identity and read-back are verified. Remote publication and handoff verification are recorded there. The documentation quality gate passed; this does not establish production implementation or companion adoption.
