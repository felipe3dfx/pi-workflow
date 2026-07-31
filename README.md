# @felipe.3dfx/pi-workflow

A public Pi meta-configuration package for the `pi-workflow` foundation setup.

This package exposes its own Pi extension plus four native workflow skills and four homonymous prompt templates. Companion packages such as Engram, MCP adapter, subagents, web access, and CodeGraph are installed explicitly as independent Pi packages so their ownership, updates, and resources stay transparent.

## Public workflow boundary

`/define-product`, `/deliver-ticket`, `/qa-handoff`, `/product-review`, and their matching `/skill:<name>` forms are admitted only from idle interactive Pi input. RPC, extension, steering, follow-up, and reentrant invocations are blocked before prompt or skill expansion. While an admitted public-entry turn is pending, the extension blocks every tool call; later workflow modules must enforce authority before any mutation.

Owner approval uses launch-host configuration, not model/tool arguments. Start Pi with exact non-empty `PI_WORKFLOW_OWNER_ACTOR_ID` and `PI_WORKFLOW_OWNER_AUTHORITY_REVISION` environment values; the packaged extension snapshots them as the host-controlled `Owner` authority when it initializes. The role is fixed by the extension and cannot be supplied by the caller. Missing values, surrounding whitespace, or incomplete configuration fail closed and cannot approve a Spec or product review. Rotate the authority revision whenever the host's Owner authorization changes.

For `product-review`, the extension also calls authenticated Linear MCP `linear_get_user` with `query: "me"` and requires the returned active, non-guest user ID to equal `PI_WORKFLOW_OWNER_ACTOR_ID`. It reauthenticates after the exact digest selection and immediately before mutation. The authority revision remains host-controlled and is bound into the canonical digest; conversational text and tool arguments cannot replace either authority input. QA and PS remain organizational/Linear roles outside this runtime authority seam.

Default `define-product` Delivery-parent publication also uses authenticated Linear MCP and does not read `LINEAR_API_KEY`. After exact Spec approval, the action-only `publish_spec` call starts a same-turn, expected-call protocol that authenticates the Owner, resolves the Owner's natural team name uniquely from paginated active teams, resolves exactly one Backlog state, and paginates exact-title candidate lookup. Immediately before the sole `linear_save_issue` call it re-reads the approved artifact and reauthenticates; the mutation contains only the resolved team, exact approved title and body, Backlog state, and null assignee/Cycle. Exact `linear_get_issue` plus candidate lookup read-back is required before success. Durable project-scoped uncertainty prevents blind retries: after an uncertain save, restart may only adopt one exact candidate or remain blocked. Direct Delivery-parent, ticket, and approved-revision gateways remain available only as explicit injected compatibility seams; the default define-product composition does not discover any of them from `LINEAR_API_KEY`.

Approved Delivery-ticket continuation is stored in the repository project's Engram namespace at the single stable topic `workflow/define-product/ticket-approval-recovery`. Its canonical digest envelope binds the exact definition, approved-Spec reference, published-parent reference, approved-ticket-graph reference and digest, and Owner authority. `session_start` re-reads and validates every referenced artifact and the current authority before it activates action-only `publish_tickets`; callers never provide a parent ID or definition identity. The selector-free store deliberately permits only one active continuation per project. An identical save is idempotent, a different active continuation is a deterministic conflict, and only a verified clear writes the canonical tombstone before a later continuation can replace it. The runtime never searches for or adopts another approved artifact implicitly.

`qa-handoff` is an implemented single-issue capability. Its public invocation accepts only one Linear ID, verifies the authenticated Developer and issue evidence through Linear MCP, and derives the canonical body, digest, authority, and revision without model input. Missing or mismatched MCP authentication, evidence, or durable storage fails closed. The only external side effect is exactly one root issue comment; status, assignee, Cycle, labels, estimate, blockers, relations, and description remain manual and unchanged.

The default packaged QA handoff composition uses only authenticated Linear MCP tools; it never reads `LINEAR_API_KEY` or calls Linear's API directly. It persists validated `qa-handoff-draft/v1` artifacts under the current repository project's Engram topic `workflow/qa-handoff-draft/<LINEAR-ID>`, stores the immutable canonical publication artifact under `workflow/qa-handoff/<LINEAR-ID>`, and uses `ENGRAM_URL` when set (otherwise Engram's local default). Before returning `published`, it checks existing comments for the exact workflow reference, creates only the canonical root comment when absent, and verifies the exact comment ID and body with a later MCP read.

The default packaged product-review composition follows the same authenticated MCP-only boundary and never reads `LINEAR_API_KEY` or calls Linear HTTP directly. It reads the create-only `product-review-draft/v1` from `workflow/product-review-draft/<LINEAR-ID>`, binds the complete protected issue snapshot and host Owner authority into two exact Spanish result digests, and requires the Owner to select one digest in a second interactive turn. The selected immutable artifact is stored at `workflow/product-review/<LINEAR-ID>`.

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

Install missing companions after reviewing the confirmation prompt:

```text
/pi-workflow-install-companions
```

Then reload Pi again so companion resources are loaded:

```text
/reload
```

In non-UI contexts, the install command prints the exact unversioned `pi install npm:<pkg>` commands instead of installing automatically. Once installed, run `pi update --extensions` (packages only) or `pi update --all` (Pi and packages) to receive upstream companion updates.

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

`apply` replans after explicit confirmation and accepts only the exact approved plan digest. Every target and manifest write uses compare-and-swap against its approved predecessor, runs under a cooperative mutation lock, and is verified by read-back. Before replacing package-owned state, the command persists digest-bound backups, successors, and an operation manifest. The returned `operationId` identifies that recovery evidence.

Use `resume <operationId>` to complete a verified interrupted operation or `rollback <operationId>` to restore verified predecessors and remove targets that were originally absent. Recovery refuses malformed evidence, unsupported paths, or an unrecognized current state. It preserves unrelated manifest ownership and project-level overrides.

Interrupting a read-only preview performs zero writes. Cancellation during apply reports whether a partial mutation occurred and remains recoverable from durable evidence. Canceled commands exit `130`, blocked/refused commands exit `1`, successful commands exit `0`, and invalid usage exits `2`.

### MCP setup

The companion install flow also manages the Pi MCP catalog from [`assets/mcp-servers.json`](assets/mcp-servers.json).

- It writes only `${PI_CODING_AGENT_DIR:-${PI_AGENT_HOME:-~/.pi/agent}}/mcp.json`.
- It preserves unrelated top-level fields and unrelated MCP servers.
- After confirmation it re-reads the latest config before writing; if a targeted `context7`, `sentry`, or `linear` entry changed after preview, the command stops and asks you to rerun against the latest file.
- Exact `context7`, `sentry`, and `linear` entries are previewed before confirmation; malformed JSON or write failures are reported with the target path and manual recovery guidance.
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
- explicit companion installation after user confirmation;
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
