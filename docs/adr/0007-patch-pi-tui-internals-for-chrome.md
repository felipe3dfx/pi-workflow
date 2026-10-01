# ADR 0007: Patch Pi TUI internals for the Grok-style chrome

## Status

Acceptance: approval and merge of the introducing PR.

## Context

Pi exposes no extension hooks for styling messages, menus, or the input editor. The harness wants the Grok Build-style chrome: restyled user and assistant messages, thinking lines, select lists, settings lists, Pi's selectors, and a rounded editor.

## Decision

pi-workflow monkey-patches Pi's TUI prototypes for message and menu styling. The replacement logic is copied from the Pi version named in each patch module's source note. The patches are applied on `session_start` and restored on `session_shutdown`. They are idempotent. There is no Pi version guard.

Where Pi does expose an API (header, footer, widgets, editor component, theme), the chrome uses it.

## Considered Options

- Use only public Pi APIs. They cannot restyle messages, lists, or selectors.
- Patch internals behind a Pi version guard that disables the chrome on unknown versions. Rejected by the owner.
- Patch internals without a guard.

## Consequences

Every Pi upgrade requires re-verifying the chrome. The patch modules (`extensions/chrome-messages.ts`, `extensions/chrome-menus.ts`) carry source notes naming the Pi version and functions they replicate. A Pi change to those internals can break the styling or the session with no warning from the harness. The peer range is the one in `package.json`.
