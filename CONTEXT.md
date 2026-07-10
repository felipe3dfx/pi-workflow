# Context

## Glossary

### pi-workflow

The coding-agent workflow harness for Pi. It coordinates the user's preferred agent workflow by relying on existing Pi packages instead of rebuilding those capabilities inside this repository.

_Avoid_: companion bundle, extension bundle, package aggregator

### Companion package

An existing Pi package that pi-workflow expects or helps install as part of the workflow harness. Companion packages remain independently owned and installed; pi-workflow does not absorb their source, internal configuration, or resources.

### Companion catalog

The curated and versioned selection of companion packages required for the complete pi-workflow harness. It is the source of truth for which external Pi packages are expected, while allowing a degraded harness when some companions are missing or mismatched. It owns expected presence and versions, not opinionated internal configuration for companion packages.

_Avoid_: companion configuration, workflow profile, package bundle

### MCP server catalog

The curated and versioned selection of MCP servers that the complete pi-workflow harness expects to be configured. It is the source of truth for expected MCP server definitions, parallel to the companion catalog: it owns which servers and definitions are expected, not how the user's environment is mutated.

_Avoid_: MCP config, mcp-servers file

### MCP configuration

The harness flow that aligns the user's MCP setup with the MCP server catalog. It plans the required changes, applies them only during an explicit companion install, and refuses to write when the user's MCP setup changed concurrently since planning.

_Avoid_: MCP setup, mcp.json editing

### Degraded harness

A pi-workflow harness state where one or more required companion packages are missing, mismatched, or unreadable. The harness may still run, and mismatches may be intentional user choices, but status and doctor flows must still make the gap explicit and guide the user back to the expected companion catalog.

### Explicit companion install

The user-confirmed action that moves a degraded harness toward the expected companion catalog. pi-workflow must not install companion packages silently during startup or inspection flows.

### Workflow profile

A future pi-workflow concept for coordinated behavior across companion packages. It is separate from the companion catalog: the catalog defines which packages and versions belong to the complete harness, while a workflow profile would define how the harness should behave.

### Harness release guard

The validation policy that protects pi-workflow releases. It validates package publish readiness and harness decisions, including exposing only pi-workflow-owned resources, not re-exporting companion resources, not bundling companion packages, and keeping the companion catalog as the source of truth.

### Workflow helper extension

The Pi extension owned and exposed by pi-workflow. It is the adapter from pi-workflow domain concepts into Pi commands, while companion resources remain exposed by their own packages rather than through the pi-workflow package manifest. Its public interface is status, doctor, and explicit companion install; harness policy should live behind it rather than inside the adapter.

_Avoid_: harness policy owner, companion resource exporter

### Harness doctor

The diagnostic flow for the pi-workflow harness. Today it diagnoses companion package state; over time it should remain the general harness diagnosis interface as new harness concepts appear. It differs from status by depth: status is a short actionable summary, while doctor provides extended diagnostic detail.
