# No companion installer module

During the 2026-07 architecture review, splitting `installMissing` into a separate companion-installer module was evaluated and rejected. The install helpers already sit beside `installMissing` as single-caller functions, so extraction would move complexity rather than concentrate it, and the install flow is already exercised through the `createCompanionWorkflow` interface. The MCP configuration extraction (`mcp-config.ts`) remains the right depth boundary; `installMissing` stays the single orchestrator, with its messaging glue collapsed into a local helper instead.

## Considered Options

- Extract a `companionInstaller` module and move `installMissing`'s install machinery behind it.
- Keep `installMissing` as the single orchestrator and collapse its repeated notify+return glue into a local helper.

## Consequences

Future architecture reviews should not re-propose the companion-installer split unless a second caller for the install machinery appears.
