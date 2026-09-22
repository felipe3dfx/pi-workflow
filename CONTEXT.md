# Context

## Glossary

### pi-workflow

The Pi harness package that reports companion readiness and installs the companion catalog after explicit confirmation. It does not own product workflow.

_Avoid_: workflow engine, publication runtime, operating system

### Companion package

An independently owned Pi package that the harness expects to be present. pi-workflow does not absorb its source or resources.

### Companion catalog

The versioned list of expected companion packages in `assets/companions.json`.

### MCP server catalog

The versioned MCP server definitions in `assets/mcp-servers.json`. Alignment happens only during an confirmed companion install.

### Degraded harness

A state where one or more companion packages are missing, unreadable, or mismatched. Status and doctor must show the gap. They must not install anything.

### Explicit companion install

The user-confirmed command `/pi-workflow-install-companions --apply`. Without `--apply`, the command only prints the plan.

### Engineering skills

The Grupo Ilao skills that own delivery process. A consumer installs them from that catalog. pi-workflow does not bundle, route, or reinterpret them.

### Harness capability

A pi-workflow behavior that is not a companion package. The harness owns it and does not install it from the companion catalog.

_Avoid_: bundled companion, absorbed package

### Child session

A Pi session distinct from the parent session. It belongs to a harness capability, not to a companion package.

_Avoid_: subagent package, workflow run
