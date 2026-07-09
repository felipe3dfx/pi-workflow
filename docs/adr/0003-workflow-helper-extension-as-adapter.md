# Workflow helper extension as adapter

The pi-workflow helper extension is the adapter from harness domain concepts into Pi commands. It should expose the public command interface for status, doctor, and explicit companion install, but harness policy should live behind that adapter in deeper modules such as the companion catalog, harness doctor, and harness release guard.

## Considered Options

- Keep adding harness policy directly inside the Pi extension module.
- Treat the extension as an adapter and move harness policy behind stable module interfaces.

## Consequences

The extension module should remain thin as the harness grows. New behavior should deepen domain modules behind the command adapter rather than widening the extension's command implementation.
