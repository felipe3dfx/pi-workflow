# Test support

| File | Exports | Use |
| --- | --- | --- |
| `child-parent.mjs` | none (subprocess) | Parent process holding one RPC child; argv is the JSON launch (`command`, `sessionRoot`, `cwd`, `model`, `ending`); prints the child's answer, then waits or, with `ending: "shutdown"`, disposes it within `shutdownDeadline` and exits. |
| `bridge-parent.mjs` | `createBridgeParentSession` | Real parent session loading the Claude Bridge extension. |
| `child-session.mjs` | `workerTools`, `spawnedTools`, `installedPackagePath` | The tool lists a child receives and the installed path of a Pi package. |
| `config-guide.mjs` | `driveConfig`, `keys`, `press`, `click`, `wheel`, `focusOn`, `rowOf`, `title`, `body`, `plain`, `catalogOf`, themes | Drive and read the `/workflow:config` panel. |
| `eventually.mjs` | `eventually` | Poll a read until its condition holds, or fail with the last value. |
| `fake-children.mjs` | `fakeChildren`, `recordingCore`, `userEntry` | Fake child session factory with scripted runs. |
| `reload-command.mjs` | none (Pi extension) | Registers `/test-reload`, which reloads the real Pi parent that loads it. |
| `fake-pi.mjs` | none (subprocess) | Fake `pi --mode rpc` process; `FAKE_PI_SCENARIO` scripts the run, `FAKE_PI_RECORD` receives its argv, cwd and pid, `<record>.launches` one pid per launch, `FAKE_PI_COMMANDS` names a file that receives each command type, `FAKE_PI_TREE` names a file that receives the pids of a detached server and a detached shell with a background sleep. It speaks the parent channel on fd 3: `ask`, `withdraw`, `report`, `oversize` and `no-runtime` scenarios. |
| `runtime-child.mjs` | `runtimeChild`, `runtimeChildSession` | Child session factory that installs the child runtime extension on an in-test agent session with a given model runtime, answering its channel requests from the spec; for registry and authorization tests that need a real agent loop without a Pi binary. |
| `fake-jev.mjs` | `classifierRegistry` | Fake Jev classifier with scripted answers. |
| `jev-routing.mjs` | `withAgentDirectory`, `turnJevRoutingOn` | Per-test agent directory; Jev routing switched on. |
| `mcp-fixture-server.mjs` | none (subprocess) | MCP stdio server; argv `name pidDir delayMs scenario`; writes `<name>.cwd`; `authorization` adds late-tool notifications and a per-server `.calls` audit for zero-dispatch assertions; `roots` records the client's `roots/list` answer in `<name>.roots`; `descendants` starts a detached shell with a background sleep and writes the server, shell and sleep pids to `<name>.tree`. |
| `model-endpoint.mjs` | `modelEndpoint` | Local OpenAI-compatible endpoint registered as `fake/echo` in an agent directory's `models.json`, so a real Pi answers without credentials. An array answer scripts one step per request: a string is a final text, `{ tool, args }` a tool call; a function answer receives each request body and returns its step. |
| `process-tree.mjs` | `alive`, `descendants`, `parent`, `gone` | Read the fake Pi's descendant pids, start `child-parent.mjs`, and wait until pids are gone. |
| `packed-subprocess.mjs` | `runPackedSubprocess` | Run a command against the packed package. |
| `signed-checkpoint.mjs` | `withCheckpoint`, `repository` | Temporary signed repositories/worktrees with isolated HOME/XDG and ephemeral SSH fixture key. |
| `selection.mjs` | `selectionWith` | Build a stored selection. |

Check this table before writing a helper or reading a large test file to find one.
