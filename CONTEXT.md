# Context

## Glossary

### pi-workflow

The Pi harness package that reports companion readiness and, on explicit `/workflow:configure`, applies the local selection. It does not own product workflow.

_Avoid_: workflow engine, publication runtime, operating system

### Companion package

An independently owned Pi package that a companion expectation can name. pi-workflow does not absorb its source or resources.

### Companion catalog

The versioned list of companion packages in `assets/companions.json`. A companion expectation names one entry from this list.

### MCP server catalog

The versioned MCP server definitions in `assets/mcp-servers.json`. Configure aligns Pi-native servers in `mcp.json` per catalog key and preserves keys the user or Pi manages. Each server has an exposure: `direct` or `deferred`.

### Degraded harness

A state where one or more companion packages named by a companion expectation are missing, unreadable, or mismatched. Status and doctor must show the gap. They must not install anything.

### Configure

The operator's guided confirmation, for the current session, of seated harness capabilities and companion expectations.

_Avoid_: setup, `/workflow:setup`, installer

### Default settings

The versioned Pi settings in `assets/settings.json` that Configure applies: `tuiMode`, `theme`, and `quietStartup`.

### Colliding package

An installed package that overlaps with a harness capability: `@heyhuynhgiabuu/pi-pretty`, `pi-powerline-footer`, or `pi-mcp-adapter`. Status, doctor, and Configure warn. The harness never uninstalls it.

### Model profile

A named set of model and thinking assignments, one per specialist, stored in `pi-workflow-models.json` (schema v2) with one profile active. A missing specialist entry inherits the session model.

### Specialist

One of `explorer`, `worker`, or `verifier`. A child's role selects its specialist: `explore` to `explorer`, `worker` to `worker`, `verify` to `verifier`.

### Engineering skills

The Grupo Ilao skills that own delivery process. A consumer installs them from that catalog. pi-workflow does not bundle, route, or reinterpret them.

### Harness capability

A pi-workflow behavior that is not a companion package: child session, todo, operator question, model profile, CodeGraph access, or compact rendering. The harness owns it and does not install it from the companion catalog.

_Avoid_: bundled companion, absorbed package

### Child session

A Pi session distinct from the parent session. It belongs to a harness capability, not to a companion package.

_Avoid_: subagent package, workflow run

### Chrome

The Grok Build-style terminal UI the harness applies: header, footer hints, status row, input editor, message and menu styling, and the `pi-workflow` theme. It patches Pi internals; see ADR 0007.

### Shell

The always-seated surface that owns visual language, screen places, and Chrome.

_Avoid_: feature board, plugin host

### Visual language

The shared theme, frame, and rhythm of the shell.

_Avoid_: design system

### Screen place

A region of the shell: the header, above the input, an overlay, or the message stream. The seated capability declares which place it occupies.

_Avoid_: feature slot

### Companion expectation

The local choice that one companion catalog entry is expected on this installation.

_Avoid_: uninstall, catalog edit

### Todo

The session's task list, seated as a harness capability.

_Avoid_: issue, ticket

### Operator question

The prompt the operator answers, seated as a harness capability.

_Avoid_: dialog, form

### Compact rendering

The harness presentation of Pi's seven tools: `read`, `bash`, `grep`, `find`, `ls`, `edit`, and `write`.

_Avoid_: pi-pretty

### CodeGraph access

The harness capability for structural questions about the current repository.

_Avoid_: companion package
