# Advisor card prototype: mock inventory

Run from the worktree root: `node prototype/advisor-card/render.mts`. It rewrites `snapshots.txt` and `snapshots.ansi.txt`.

Real, not mocked: `compactToolRenderers` resolver chain, `ToolExecutionComponent` (lifecycle, `renderShell: "self"`, `MouseRegion` click toggle, `durationMs`), `CustomMessageComponent`, pi-tui `Markdown`, `getMarkdownTheme`, `keyText`, the `pi-workflow` theme loaded with `loadThemeFromPath(..., "truecolor")`, the repo's `registerChildResultCards`, `answerCard`, `patchChat`, `transcriptCursor`, `edgeFor`/`assistantInset`, `childElapsed`, `childModelLine`, `terminalSafeLine`/`terminalSafeBlock`, `spread`, `themeVar`.

| Mocked or simulated behavior | Where | Replacement boundary |
| --- | --- | --- |
| Advisor capability seating: `seating.advisor` flag instead of `seated("advisor", "message-stream")`. `advisor` is not in `capabilities` or `placement` on this branch, so the real call throws. | `advisor-card.ts` `seating` | `extensions/shell.ts` `placement` gains `advisor: [{ place: "message-stream", ... }]`; the card calls `seated("advisor", "message-stream")`. |
| Every other capability seated (`replaceSelection` with all `true`). | `render.mts` | The real stored selection read by `readSelection`. |
| The advisor tool's `execute`: never runs. Its results are injected with `updateResult` (partial, then final with `durationMs`). | `render.mts` `advisor()` | The real `advisor` tool `execute`, which must emit `onUpdate({ content: [], details: { model, thinking } })` before the model call and return a final result with the same `details`, plus `failure` and `isError: true` on failure. |
| Advisor model call (provider, streaming, thinking, context projection): absent. Advice text is a fixture. | `fixtures.ts` `advice`, `short`, `fenced`, `hostileAdvice` | Pi `stream` / `modelRegistry.streamSimple` call with the parent's projected context. |
| Failure reasons: fixture strings, worded after `child-launcher.ts` `profilePair` and the brief's scenario 5 refusal. Their `failure` code (`unavailable`, `thinking`, `provider`, `overflow`, `aborted`, `refused`) is a proposed `details` field. | `render.mts` `failed()` | The real availability and thinking checks (shared with `profilePair`), the provider error, the context-window check, the abort signal, and the seating/model refusal in `execute`. |
| Operator abort: a final result with `failure: "aborted"`. Pi's own pre-execution abort (`Operation aborted`, no details) is not simulated. | `render.mts` state 12 | Pi agent loop abort plus `execute` catching its signal. |
| Elapsed time: `durationMs` handed to `updateResult`; no clock or timer. A running card shows no live elapsed. | `render.mts` `done()` | Pi's measured `durationMs` from the final tool result. |
| Expand key: `app.tools.expand` bound to `ctrl+o` on the pi-tui instance Pi resolves. | `render.mts` | The operator's keybindings. |
| Global `ctrl+o`: simulated with `setExpanded(true)`. | `render.mts` state 04 | `InteractiveMode` toggling `toolOutputExpanded` on every tool row. |
| Mouse: one synthetic left click on row 1 of the tool component. | `render.mts` `clicked()` | Terminal mouse events routed through `patchChat` rows. |
| Chalk color level pinned to 3, so `theme.bold` emits the same output piped or on a TTY. | `render.mts` | The terminal's detected color support. |
| Family scene: a bare `Container` patched with `patchChat`, with no `Framed` tool rows from `chrome-messages` and no Pi spacers between messages. The `◆ Codegraph query` row after the advisor therefore has no margin. | `render.mts` `family()` | `InteractiveMode.addMessageToChat` with `patchMessages`. |
| Transcript cursor: `transcriptCursor.move(-1)` on a bare `Container` patched with `patchChat`; no `InteractiveMode`, viewport or editor. | `render.mts` `family()` | The interactive chat container patched by `chrome-messages.ts` `foldChat`. |
| Family scene: child question and result cards come from fixture `details`; the Parent answer card is hosted by a stand-in `reply_child` renderer that mirrors `child-sessions.ts`. | `render.mts` `family()`, `fixtures.ts` | The real `child-sessions` tools and messages. |
| Temporary component: `AdvisorCard`, `Fallback`, `bodyLines` copied or adapted from `extensions/child-result-card.ts` (not exported there). | `advisor-card.ts` | A shared export from `child-result-card.ts` (`frame`, `bodyLines`, `Fallback`, `plainHead`) or a new `extensions/advisor-card.ts`. |
| The `◇` glyph variant: `chrome-groups.ts` `pointAt` only matches `[◆◈]`, so the cursor marker does not appear (state 25). | none (observed) | Either widen `pointAt` to `[◆◇◈]` or adopt the `◆` variant (state 26). |

Deviation: `knip` reports the three prototype files as unused, so `npm run check` fails while they exist. Root config was not edited. `biome lint prototype/advisor-card` passes; `tsconfig.json` does not include `prototype/`.
