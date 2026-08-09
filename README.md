# @felipe.3dfx/pi-workflow

A public Pi meta-configuration package for the `pi-workflow` foundation setup.

This package exposes its own Pi extension plus four native workflow skills and four homonymous prompt templates. Companion packages such as Engram, MCP adapter, subagents, web access, and CodeGraph are installed explicitly as independent Pi packages so their ownership, updates, and resources stay transparent.

## Public workflow boundary

`/define-product`, `/deliver-ticket`, `/qa-handoff`, `/product-review`, and their matching `/skill:<name>` forms are admitted only from idle interactive Pi input. RPC, extension, steering, follow-up, and reentrant invocations are blocked before prompt or skill expansion. Pending capabilities block every tool. Implemented capabilities expose only workflow-owned tools, and `ask_user_question` is allowed only while a compatible shared decision is active.

All active closed human choices use `extensions/interactive-decisions.ts`. The same transport-neutral descriptor renders either the compatible Pi panel or a numbered fallback. A fresh private claim issues one execution lease for one logical operation; its manifest binds `decisionId`, `operationDigest`, `executionId`, and fencing `generation` before the first effect. Every internal effect rechecks that lease and its domain predecessor or read-back evidence. Semantic tool actions transport a claimed choice but never authorize effects by themselves, and skills do not require exact approval phrases. The authoritative current-state ledger is [`docs/design/interactive-decision-inventory.md`](docs/design/interactive-decision-inventory.md).

The default package uses a single-user harness authority model and requires no `PI_WORKFLOW_OWNER_*` environment variables. Each relevant execution calls authenticated Linear MCP `linear_get_user` with exactly `{"query":"me"}` once, requires one active non-guest user, freezes that identity for the execution, and projects workflow authority with the stable revision `single-user/v1`. The cached identity is reused for later approvals, reads, and mutations; repeated identity lookups are rejected. Owner and Developer remain organizational roles selected by the workflow, not claims accepted from model or tool arguments.

Embeddings may still inject an explicit authenticated authority as a compatibility policy. When supplied, the authenticated Linear user must match that policy and new projections retain its authority revision. This optional seam is never discovered from environment variables and does not change the default. Historical actor and authority-revision fields remain immutable provenance in existing approved artifacts; under the default single-user model they do not invalidate recovery merely because a new sandbox lacks the old host configuration.

Default `define-product` Delivery-parent publication uses authenticated Linear MCP and does not read `LINEAR_API_KEY`. A new definition authenticates once before workflow actions; the parent and ticket publishers reuse that cached identity. A recovered publication authenticates once when no execution identity is cached. The action-only `publish_spec` protocol resolves the immutable team ID, exactly one Backlog state, and paginated exact-title candidates. Immediately before the sole `linear_save_issue` call it re-reads the exact approved artifact, but does not repeat `linear_get_user`. The mutation contains only the resolved team, exact approved title and body, Backlog state, and null assignee/Cycle. Exact issue and candidate read-back, durable uncertainty, CAS, and idempotent adoption remain required. Direct Delivery-parent, ticket, and approved-revision gateways remain explicit compatibility seams only.

Approved Delivery-ticket continuation is stored in the repository project's Engram namespace at the single stable topic `workflow/define-product/ticket-approval-recovery`. Its canonical digest envelope binds the exact definition, approved-Spec reference, published-parent reference, approved-ticket-graph reference and digest, and historical Owner provenance. `session_start` re-reads and validates every referenced artifact and all content bindings without requiring the prior sandbox's actor or authority revision. Action-only `publish_tickets` then authenticates one active non-guest Linear user and publishes through the exact MCP protocol. Content, artifact revision, graph, parent, or digest drift still blocks. The selector-free store permits one active continuation per project; identical saves are idempotent, conflicting continuations fail, and only verified clear writes the canonical tombstone.

`qa-handoff` is an implemented single-issue capability. Its public invocation accepts only one Linear ID but does not authorize publication. The runtime authenticates one active non-guest Linear user once, verifies that user as the issue's assigned and labeled Developer, derives the canonical body and stable `single-user/v1` authority projection without model input, and presents the shared publish/cancel decision. Missing or malformed authentication, evidence, decision authority, or durable storage fails closed. Existing canonical artifacts retain historical authority provenance when their approved content still matches. The only external side effect is exactly one root issue comment; status, assignee, Cycle, labels, estimate, blockers, relations, and description remain manual and unchanged.

The default packaged QA handoff composition uses only authenticated Linear MCP tools; it never reads `LINEAR_API_KEY` or calls Linear's API directly. It persists validated `qa-handoff-draft/v1` artifacts under the current repository project's Engram topic `workflow/qa-handoff-draft/<LINEAR-ID>`, stores the immutable canonical publication artifact under `workflow/qa-handoff/<LINEAR-ID>`, and uses `ENGRAM_URL` when set (otherwise Engram's local default). Before returning `published`, it checks existing comments for the exact workflow reference, creates only the canonical root comment when absent, and verifies the exact comment ID and body with a later MCP read.

The default packaged product-review composition follows the same authenticated MCP-only boundary and never reads `LINEAR_API_KEY`, `PI_WORKFLOW_OWNER_*`, or Linear HTTP directly. It authenticates once, reads the create-only `product-review-draft/v1` from `workflow/product-review-draft/<LINEAR-ID>`, binds the complete protected issue snapshot and stable Owner projection into two exact Spanish results, and presents those results through the shared decision panel or numbered fallback. It reuses the cached identity after the claimed semantic selection and before the one comment mutation. Existing exact artifacts retain their historical authority provenance when protected issue content and draft remain unchanged. The selected immutable artifact is stored at `workflow/product-review/<LINEAR-ID>`.

Canonical `product-review/v1` artifacts created by the earlier direct-workflow implementation did not contain `payload.issue.protectedDigest`. The artifact reader continues to validate and return those legacy bytes with their original digest and body so persisted v1 data remains inspectable, but the create-only store never writes a new digest-less artifact or overwrites one. The authenticated MCP publication path refuses such a legacy artifact before mutation because it cannot prove the complete protected MCP issue binding; every newly produced MCP artifact requires `protectedDigest`.

Product-review publication scans every paginated comment page, considers only root issue comments for workflow-reference adoption, rejects duplicate or conflicting roots, and substitutes the canonical body only into the exact planned `linear_save_comment` call. It never calls an issue mutation tool. A durable uncertain claim at `workflow/product-review-publication-recovery/<LINEAR-ID>` prevents blind mutation retry after interruption; a later process can only adopt and verify the exact comment or remain blocked. After exact comment read-back, only a monotonic `updatedAt` advance is allowed; every other protected issue field must remain byte-for-byte canonical.

Accepted Linear MCP tool-call identities remain reserved for the lifetime of the loaded QA handoff extension/runtime, including across Pi `session_start` events, so a late result from an earlier session cannot be reused by a later handoff. The reservation is fail-closed and bounded at 16,384 identities; it is never evicted or reset per session. If the runtime reaches that boundary, reload the extension before starting another QA handoff.

Publication recovery is currently scoped to the repository's Engram project namespace. The available authenticated Linear MCP user and issue evidence does not expose a trusted, stable Linear workspace identity, and a constant pseudo-global key would collide when separate Linear workspaces use the same issue identifier. Consequently, two different repository project namespaces can independently claim the same Linear issue; operators must not publish one workspace issue from multiple repository projects. This limitation remains fail-closed within each project and should change only when trusted workspace-global identity evidence is available.

### QA handoff draft producer contract

Delivery evidence producers must persist the internal, derivable draft through the exported `createQaHandoffDraftStore` create-only boundary before invoking `/qa-handoff`. The topic is `workflow/qa-handoff-draft/<LINEAR-ID>`, and the canonical schema is:

```json
{
  "schema": "qa-handoff-draft",
  "schemaVersion": 1,
  "payload": {
    "issue": { "id": "ILA-2321" },
    "draft": {
      "outcome": { "status": "ready-for-qa", "summary": "..." },
      "pullRequest": { "ref": "...", "label": "...", "url": "..." },
      "build": { "ref": "...", "label": "...", "url": "..." },
      "qaEnvironment": { "name": "...", "url": "...", "revision": "..." },
      "acceptanceCriteria": [
        { "id": "AC-1", "description": "...", "evidence": [{ "ref": "...", "label": "..." }] }
      ],
      "testGuidance": ["..."],
      "risksAndConstraints": ["..."],
      "outOfScope": ["..."]
    }
  },
  "digest": "<sha256-of-canonical-unsigned-envelope>"
}
```

The digest is exactly `digestCanonicalValue({ schema, schemaVersion, payload })`; the `digest` field itself is excluded from the digest input. The stored bytes are `canonicalJson(envelope)` plus one newline. Reads and create-only recovery require the exact digest, canonical bytes, and payload issue ID matching the topic suffix and invocation ID. Missing, malformed, noncanonical, extra-field, digest-mismatched, or issue-mismatched artifacts fail closed. The draft contains structured evidence only; it does not contain the publication body, authority, or caller-selected publication data. The workflow derives the exact Spanish Linear comment and its digest internally, without another confirmation step.

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

Install missing companions after reviewing the shared package-and-MCP decision:

```text
/pi-workflow-install-companions
```

Then reload Pi again so companion resources are loaded:

```text
/reload
```

In non-UI contexts, automatic companion installation fails closed and prints the exact unversioned `pi install npm:<pkg>` commands instead of mutating package or MCP state. Once installed, run `pi update --extensions` (packages only) or `pi update --all` (Pi and packages) to receive upstream companion updates.

### Disposable Pi test launcher

Launch the repository-pinned Pi CLI with an isolated home, configuration, packages, and session directory:

```bash
npm run pi:sandbox
```

The launcher loads this checkout with `-e`, prevents Pi from automatically discovering or writing the current `~/.pi` and `~/.agents` installation, disables startup update checks and telemetry, and removes its temporary sandbox when Pi exits. It is configuration isolation rather than a filesystem security sandbox: Pi tools can still access paths that you explicitly request. Authentication is isolated as well: export a provider API key before launch, or preserve the sandbox while using `/login`:

```bash
npm run pi:sandbox -- --keep
```

Forward Pi CLI arguments after a second `--`; inspect the exact launch plan without starting Pi with `--dry-run`:

```bash
npm run pi:sandbox -- --dry-run -- --version
npm run pi:sandbox -- -- --mode rpc --no-session
```

The launcher rejects explicit resource paths, session imports/exports, session-directory overrides, and trust flags that could cross its isolation boundary. It also discards inherited `PI_PACKAGE_DIR` values and forwards terminal signals to Pi before cleanup. A preserved sandbox path is printed on exit and must be removed manually when testing is complete.

### Agent asset sync and recovery

The packaged CLI inspects, plans, applies, resumes, and rolls back package-managed agent assets:

```bash
pi-workflow-sync inspect
pi-workflow-sync plan
pi-workflow-sync apply
pi-workflow-sync resume <operationId>
pi-workflow-sync rollback <operationId>
```

`inspect` and `plan` are strictly read-only and return `mutation: "none"`. `inspect` reports ownership and drift; `plan` derives deterministic `create`, `replace`, or `migrate` actions. A `refusal` blocks unmanaged collisions, managed drift, unsupported migration chains, and newer installed versions before mutation.

`apply` replans after the shared semantic decision and accepts only the exact approved plan digest. One execution lease covers every internal write. Every target and manifest write rechecks fencing, uses compare-and-swap against its approved predecessor, runs under a cooperative mutation lock, and is verified by read-back. Before replacing package-owned state, the command persists digest-bound backups, successors, and an execution-bound operation manifest. The returned `operationId` identifies that recovery evidence.

Use `resume <operationId>` to complete a verified interrupted operation or `rollback <operationId>` to restore verified predecessors and remove targets that were originally absent. Recovery refuses malformed evidence, unsupported paths, or an unrecognized current state. It preserves unrelated manifest ownership and project-level overrides.

Interrupting a read-only preview performs zero writes. Cancellation during apply reports whether a partial mutation occurred and remains recoverable from durable evidence. Canceled commands exit `130`, blocked/refused commands exit `1`, successful commands exit `0`, and invalid usage exits `2`.

### MCP setup

The companion install flow also manages the Pi MCP catalog from [`assets/mcp-servers.json`](assets/mcp-servers.json).

- It writes only `${PI_CODING_AGENT_DIR:-${PI_AGENT_HOME:-~/.pi/agent}}/mcp.json`.
- It preserves unrelated top-level fields and unrelated MCP servers.
- After the shared decision it re-reads the latest config before writing; if a targeted `context7`, `sentry`, or `linear` entry changed after preview, the command prepares shared reconciliation instead of retrying blindly.
- Exact `context7`, `sentry`, and `linear` entries are included in the shared plan before approval; malformed JSON or write failures are reported with the target path and manual recovery guidance.
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
   pi install npm:@vndv/pi-codegraph
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

Companion package names are defined in [`assets/companions.json`](assets/companions.json), which is the single source of truth. They are installed as unversioned npm sources so Pi can update them through its normal package-management commands.

Configured companions:

- `gentle-engram`
- `pi-mcp-adapter`
- `@tintinweb/pi-subagents`
- `pi-web-access`
- `@vndv/pi-codegraph`

## Scope

In scope:

- one local `pi-workflow` helper extension;
- four public workflow skills and four thin homonymous prompt templates;
- status and doctor commands for configured companions;
- CodeGraph companion, CLI, and project-index readiness diagnostics;
- explicit companion installation after a shared semantic decision;
- unversioned companion sources updated explicitly through Pi;
- deterministic generation of public skills and prompts from `scripts/public-workflow-catalog.mjs`;
- install and update documentation.

Out of scope:

- bundling third-party Pi package source;
- re-exporting third-party extensions or skills through this package manifest;
- silently installing companion packages;
- automatically initializing CodeGraph indexes;
- proprietary company workflow behavior;
- updating companions automatically at startup;
- mutating unmanaged files or silently resolving sync refusals.

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

Third-party packages are not runtime `dependencies` of this package because Pi installs them independently with `pi install`. The source of truth for companion package names is `assets/companions.json`; installed versions are managed by Pi.

## Validation

Refresh the lockfile without running lifecycle scripts, then run the release guard:

```bash
npm install --package-lock-only --ignore-scripts
npm run check
```

Public workflow assets are human-readable generated files. Edit `scripts/public-workflow-catalog.mjs`, then run `npm run generate:public-workflows`; `npm run check` fails if generated resources are stale.

The release guard validates that:

- GitHub Release bodies are validated as English Markdown with non-empty `Implemented`, `Migrations`, `Required sync`, `Capability changes`, and `Rollback` sections;
- packed acceptance executes real extracted-package modules with deterministic fakes and digest-bound evidence;
- the package name and public publish config are correct;
- `pi-package` is present in keywords;
- only the local `pi-workflow` extension is exposed;
- exactly four homonymous workflow skills and prompt templates are exposed;
- prompt templates contain only exact skill loading and argument forwarding;
- public workflow resources exactly match the authoritative catalog;
- the authoritative interactive-decision inventory reports zero active unmigrated choices and remains present in the packed package;
- every migrated manifest validator requires `executionId` and fencing generation evidence;
- active skills and runtimes contain no phrase-based or legacy closed-choice authorization route;
- no Pi manifest paths point into `node_modules`;
- no `bundledDependencies` or `bundleDependencies` field exists;
- companion metadata includes the expected unversioned package names;
- package metadata declares Node.js `>=22.19`;
- package scripts and release basics remain present;
- `npm pack --dry-run` succeeds.

## Companion update policy

Companions are registered with Pi without versions. Pi therefore resolves the current npm release during installation and can update existing installations explicitly:

```bash
pi update --extensions # update installed Pi packages
pi update --all        # update Pi and installed packages
```

The workflow does not update packages during startup and does not enforce compatibility with a particular companion version. Review upstream changelogs before updating when stability is important. Changes to the companion package set in `assets/companions.json` remain reviewed repository changes.

## Release CI/CD

CI runs `npm run check` on pushes and pull requests to `main` via `.github/workflows/ci.yml`. The check includes the packed acceptance command, which creates one tarball, validates its distribution, extracts it, imports workflow modules only from that extraction, and emits complete digest-bound evidence. Acceptance never invokes `npm publish`.

Publishing runs only when a GitHub Release is published via `.github/workflows/publish.yml`. The workflow requires the release tag to equal `v<package.json version>` and validates the per-release English body, then publishes with npm provenance. It uses the GitHub environment named `npm`; configure that environment with the npm trusted-publishing or token settings required by the repository.

See [`docs/acceptance-and-release.md`](docs/acceptance-and-release.md) for the scenario matrix, evidence contract, and release procedure.

## Research notes

The initial package shape was informed by reviewing `context-mode` as a mature Pi package example. The project later chose the explicit meta-configuration model documented here. See:

- [`docs/research/context-mode-package-patterns.md`](docs/research/context-mode-package-patterns.md)
