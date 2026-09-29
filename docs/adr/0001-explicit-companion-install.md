# Explicit companion install

pi-workflow does not install companion packages silently during startup, status, or doctor flows. The harness may inspect companion package state and guide the user back to the expected companion catalog, but mutating the user's Pi environment requires the user to run the explicit `/workflow:setup` command because companion packages are independently owned and installed. The same command also aligns the MCP server catalog and the default Pi settings, and warns about colliding packages without removing them.

## Considered Options

- Install missing or mismatched companions automatically during startup.
- Report degraded harness state and require `/workflow:setup` for installation.

## Consequences

A degraded harness can remain degraded until the user acts, but pi-workflow preserves user control over environment changes and avoids surprising package installs.
