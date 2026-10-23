# #304 implementation evidence

## Scope and environment

- Ticket: #304, "Keep Claude Bridge and web access in RPC children"; branch `304`, based on `296-rpc-children` at `8aa69af`.
- Specification: `docs/specs/rpc-child-sessions.md`, sections 2, 4 and 7.7; ADR 0016.
- Host: Linux 7.2.8, Node v26.12.1, standalone Pi 1.4.0 on `PATH`, installed `pi-claude-bridge` 0.9.3 and `pi-web-access`. No macOS run was made.
- Real-binary tests run against the installed `pi` with a scratch `PI_CODING_AGENT_DIR` whose `npm/node_modules` links to the installed packages, and a local OpenAI-compatible endpoint. They skip with an explicit reason when `pi` or the package is missing.

## What changed

- `extensions/web-access.ts`: `resolveWebAccessExtensions` returns the extension files `pi-web-access` declares, from the same places as before (trusted project scope, then user scope). It throws instead of degrading when the package is not installed or declares no extension.
- `extensions/rpc-child.ts`: before spawning, an explorer resolves `pi-web-access` and a child whose model provider is `claude-bridge` resolves the official extension with the unchanged `resolveClaudeBridgeExtension` (ADR 0016 identity, scope precedence, filter and single-resource rules). Each resolved file is passed as `--extension <absolute path>`. A failed resolution rejects the factory, so the launch is refused with the cause.
- The explorer's tool allowlist already carried `web_search`, `source_check`, `fetch_content` and `get_search_content`.

## Scenario evidence

| Scenario | Proof | Output excerpt |
| --- | --- | --- |
| A Claude Bridge child receives the official provider extension; a native-model child does not | `test/rpc-child.test.mjs` "a Claude Bridge RPC child receives the official provider extension and a native model child does not" | `✔ a Claude Bridge RPC child receives the official provider extension and a native model child does not` |
| An explorer receives the `pi-web-access` extension; other roles do not | `test/rpc-child.test.mjs` "an explorer RPC child receives the pi-web-access extension and other roles do not"; `test/child-sessions.test.mjs` "the default child factory runs a background child as the Pi process on PATH and delivers its result" | `✔ an explorer RPC child receives the pi-web-access extension and other roles do not` |
| A missing resource fails the launch with its cause | `test/rpc-child.test.mjs` "a missing pi-web-access or Claude Bridge package fails the launch with its cause", "a pi-web-access package without an extension fails the launch with its cause" | `pi-web-access is not installed locally, so the explorer has no web tools.` / `official pi-claude-bridge package is not installed and configured` |
| ADR 0016 resolution and failure constraints | Unchanged `resolveClaudeBridgeExtension`; its existing suite in `test/child-sessions.test.mjs` passes unchanged | Full gate below |
| Real Pi explorer offers the web tools to its model (real-binary) | `test/rpc-child-pi.test.mjs` "a real Pi explorer child offers the pi-web-access tools to its model" | `ℹ offered: read, web_search, source_check, fetch_content, get_search_content` |
| Real Pi child with a Claude Bridge model loads the provider and answers; without the package the launch is refused (real-binary) | `test/rpc-child-pi.test.mjs` "a real Pi child with a Claude Bridge model loads the provider and a missing package fails the launch" | `ℹ answered: DONE` |

## Quality gate

`npm run check` in the worktree: exit 0, wall clock 21.7 s; `node --test`: 1270 tests, 1255 passed, 15 skipped, 0 failed; "Packed distribution validation passed."

## Open gaps

- No macOS evidence was produced on this Linux host.
- The Claude Bridge answer in the real-binary test depends on the host's Claude authentication; without it the test still asserts that the provider loaded and the launch was not refused.
- `explorerWeb` and the `jiti` web-access load stay in `extensions/web-access.ts` for the SDK adapter until #305.
