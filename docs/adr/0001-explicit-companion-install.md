# Explicit companion install

pi-workflow does not install companion packages silently during startup, status, or doctor flows. The harness may inspect companion package state and guide the user back to the expected companion catalog, but mutating the user's Pi environment requires an explicit install action and user confirmation because companion packages are independently owned and installed.

## Considered Options

- Install missing or mismatched companions automatically during startup.
- Report degraded harness state and require `/pi-workflow-install-companions` for installation.

## Consequences

A degraded harness can remain degraded until the user acts, but pi-workflow preserves user control over environment changes and avoids surprising package installs.
