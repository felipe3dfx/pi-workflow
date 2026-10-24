# #305 implementation evidence

## Scope and environment

- Ticket: #305, "Retire the in-process path and record the decision"; branch `305`, based on `296-rpc-children`.
- Specification: `docs/specs/rpc-child-sessions.md`, sections 2, 7.9, 11 and 12.
- Host: Linux, Node v26, installed Pi 1.4.0 on PATH. No macOS run was made.

## What changed

- `extensions/child-sessions.ts`: the SDK child adapter `createPiChildSession` is removed with its workarounds: the stream-function cancellation patch, the private model-runtime access (`parentRuntime`), the MCP `cwd` substitution (`parentMcp`), the in-memory settings and the resource loader. `ChildSpec.modelRegistry` and the `modelRegistry` launch field are removed; the RPC factory never read them.
- `extensions/child-toolbox.ts`: removed. It was the headless Todo, audit and child tools of an in-process contextual child; an RPC child cannot launch grandchildren (#300 gap).
- `extensions/web-access.ts`: `explorerWeb`, the `jiti` evaluation of `pi-web-access` and its host-module map are removed. `package.json` drops its only runtime dependency, `jiti`. The user-scope package manager cache stays, because Pi does not cache the global root lookup.
- `extensions/child-runtime.ts`: the child loads `codemode` itself without the `models` API, as the SDK child did; `rpc-child.ts` no longer passes `builtin:codemode`, whose `models` API cannot be turned off by a flag. The child registers `codegraph` when the parent has CodeGraph access seated (`codegraph` in `--pi-workflow-child`); `createChildCodeGraphTool` no longer reads the seating, which a child process does not have.
- Retained module-level state, each with its reason: the process-tree watchdog token on `globalThis` (one watchdog per parent across reloads, #301), the resident slot that hands working children to the reloaded runtime (#302), and the `pi-web-access` package manager cache above.
- `docs/adr/0023-children-run-as-rpc-processes.md`: the successor ADR. It supersedes ADR 0016, amends ADR 0010 for `/reload` and replaces D7 with write-surface admission. It carries forward ADR 0016's Claude Bridge resolution and failure constraints. ADRs 0010, 0014 and 0016 point to it.
- `GLOSSARY.md`: new terms Write surface and Claim; Child session names its own process.
- `README.md`: the child-session bullet and the contextual section describe RPC children.
- Distribution validator: `extensions/child-runtime.ts` and `extensions/process-tree.sh` were already required (#299, #301); the removed `child-toolbox.ts` was never required. No change was needed.
- Tests: the SDK-adapter tests are removed or ported. Registry and authorization suites that need a real agent loop now run the child runtime extension on an in-test agent session (`test/support/runtime-child.mjs`). `test/child-codemode.test.mjs` is replaced by a real-binary test. `test/child-checkpoint-live.test.mjs` and the child tests of `test/claude-bridge-live.test.mjs` (opt-in, SDK child on the parent's in-memory runtime) are removed; the RPC Bridge and checkpoint evidence is in `test/rpc-child-pi.test.mjs` (#300, #304).

## Scenario evidence

| Scenario | Proof | Output excerpt |
| --- | --- | --- |
| No in-process path or reference remains in code (demo search) | `grep -rnE "createPiChildSession\|parentRuntime\|parentMcp\|streamFunction\|explorerWeb\|loadWebAccess\|jiti\|childToolbox\|registry as unknown" extensions scripts test package.json knip.json` | two hits, both in `test/contextual-authorization.test.mjs:2453-2454`, a parent-session spy on its own `streamFunction` |
| The decision chain is coherent (demo search) | `grep -rl "in-process" docs/adr` | `0014` (superseded by 0016 and 0023), `0016` (superseded by 0023), `0023` (the successor) |
| A child's codemode offers no models API and calls only allowlisted tools (real binary, Pi 1.4.0) | `test/rpc-child-pi.test.mjs` "a real Pi child's codemode offers no models API ..." | `ℹ codemode: {"tools":["ask_parent","find","grep","list_mcp_resource_templates","list_mcp_resources","ls","mcp__global__echo","read","read_mcp_resource","report_result"],"models":"undefined"}` |
| The guarded bash holds inside a script (real binary) | "a real Pi worker's guard holds inside a script ..." | `✔ a real Pi worker's guard holds inside a script and its granted checkpoint makes a signed commit the parent records` |
| A child gets codegraph only when the parent has it seated | `test/child-runtime.test.mjs`, `test/rpc-child.test.mjs` | `✔ the child registers codegraph only when the parent has CodeGraph seated`, `✔ an RPC child gets codegraph when the parent has CodeGraph seated` |
| Consultation, nested dispatch and task commits evaluated by the child runtime | `test/contextual-authorization.test.mjs` on `runtimeChild` | `ℹ tests 147`, `ℹ pass 147` (file run) |
| Registry behavior on a real agent loop: cancellation, stall, questions, reports, steering, `continue_child` | `test/child-sessions.test.mjs` "... on a real agent session ..." | `✔ cancelling a streaming child on a real agent session leaves it cancelled, not failed, and stops its provider stream` |
| All real-binary RPC tests against the installed Pi 1.4.0 | `node --test test/rpc-child-pi.test.mjs` with `pi` 1.4.0 first on PATH | `ℹ tests 25`, `ℹ pass 25`, `ℹ fail 0`, `ℹ skipped 0` |

## Quality gate

`npm run check`: exit 0, tests 1298, pass 1295, fail 0, skipped 3 (opt-in live suites), wall clock 43 s.

## Open gaps

- No macOS evidence was produced on this Linux host.
- The native relationships of #295, #204 and #293 were not moved from #296 to the tickets they depend on: this implementation writes nothing to GitHub. The parent must do it.
- Removed SDK-only coverage with no RPC counterpart: the stable request prefix across two children of one Specialist is now exercised only on the in-test agent session, not on a real Pi binary; the opt-in live Claude Bridge child suites (real model calls) have no RPC port, and the real-binary Bridge test of #304 depends on the host's Claude authentication.
- A held proposal is reported by `pendingAuthorizations()` only after its decision entry is written, so a proposal still in consultation is not listed (#300 gap); one assertion of the SDK-era consultation test that relied on the live list was removed.
- `codegraph` in a child is registered from the parent's seating at launch; a seating change while the child runs does not reach it.
