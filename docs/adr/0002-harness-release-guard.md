# Harness release guard

The pi-workflow release guard validates both npm publish readiness and the architectural decisions of the workflow harness. It must protect decisions such as not re-exporting companion package resources, not bundling companion packages, and treating the companion catalog as the source of truth for expected companion packages.

## Considered Options

- Keep the release guard as a generic package/publication validator.
- Treat the release guard as the harness policy that prevents accidental drift from pi-workflow decisions.

## Consequences

The release guard can contain checks that are more specific than normal npm package validation. Those checks are intentional because they protect the harness model, not just the publish pipeline. The guard validates catalog shape and harness decisions, not catalog values: expected companion versions and MCP server definitions live only in the assets, and drift in them is caught by reviewing asset diffs, not by the guard.
