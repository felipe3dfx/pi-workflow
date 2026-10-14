# Test support

| File | Exports | Use |
| --- | --- | --- |
| `bridge-parent.mjs` | `createBridgeParentSession` | Real parent session loading the Claude Bridge extension. |
| `child-session.mjs` | `workerTools`, `spawnedTools`, `installedPackagePath`, `piChildSession` | Real Pi child session and the tool lists a child receives. |
| `config-guide.mjs` | `driveConfig`, `keys`, `press`, `click`, `wheel`, `focusOn`, `rowOf`, `title`, `body`, `plain`, `catalogOf`, themes | Drive and read the `/workflow:config` panel. |
| `fake-children.mjs` | `fakeChildren`, `recordingCore`, `userEntry` | Fake child session factory with scripted runs. |
| `fake-jev.mjs` | `classifierRegistry` | Fake Jev classifier with scripted answers. |
| `jev-routing.mjs` | `withAgentDirectory`, `turnJevRoutingOn` | Per-test agent directory; Jev routing switched on. |
| `mcp-fixture-server.mjs` | none (subprocess) | MCP stdio server; argv `name pidDir delayMs scenario`. |
| `packed-subprocess.mjs` | `runPackedSubprocess` | Run a command against the packed package. |
| `selection.mjs` | `selectionWith` | Build a stored selection. |

Check this table before writing a helper or reading a large test file to find one.
