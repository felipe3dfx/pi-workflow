# Context

## Glossary

### pi-workflow

The Pi harness package that reports companion readiness and, on explicit `/workflow:setup`, installs the companion catalog, aligns MCP servers, and applies default Pi settings. It does not own product workflow.

_Avoid_: workflow engine, publication runtime, operating system

### Companion package

An independently owned Pi package that the harness expects to be present. pi-workflow does not absorb its source or resources.

### Companion catalog

The versioned list of expected companion packages in `assets/companions.json`.

### MCP server catalog

The versioned MCP server definitions in `assets/mcp-servers.json`. Setup aligns Pi-native servers in `mcp.json` per catalog key and preserves keys the user or Pi manages. Each server has an exposure: `direct` or `deferred`.

### Degraded harness

A state where one or more companion packages are missing, unreadable, or mismatched. Status and doctor must show the gap. They must not install anything.

### Setup

The user-run command `/workflow:setup` (previously the explicit companion install). It takes no arguments, installs missing companions directly, aligns the MCP server catalog, and applies the default Pi settings. It warns about colliding packages and never removes them.

### Default settings

The versioned Pi settings in `assets/settings.json` that setup applies: `tuiMode`, `theme`, and `quietStartup`.

### Colliding package

An installed package that overlaps with a harness capability: `@heyhuynhgiabuu/pi-pretty`, `pi-powerline-footer`, or `pi-mcp-adapter`. Status, doctor, and setup warn. The harness never uninstalls it.

### Model profile

A named set of model and thinking assignments, one per specialist, stored in `pi-workflow-models.json` (schema v2) with one profile active. A missing specialist entry inherits the session model.

### Specialist

One of `explorer`, `worker`, or `verifier`. A child's role selects its specialist: `explore` to `explorer`, `worker` to `worker`, `verify` to `verifier`.

### Engineering skills

The Grupo Ilao skills that own delivery process. A consumer installs them from that catalog. pi-workflow does not bundle, route, or reinterpret them.

### Harness capability

A pi-workflow behavior that is not a companion package. The harness owns it and does not install it from the companion catalog.

_Avoid_: bundled companion, absorbed package

### Child session

A Pi session distinct from the parent session. It belongs to a harness capability, not to a companion package.

_Avoid_: subagent package, workflow run

### Chrome

The Grok Build-style terminal UI the harness applies: header, footer hints, status row, input editor, message and menu styling, and the `pi-workflow` theme. It patches Pi internals; see ADR 0007.
