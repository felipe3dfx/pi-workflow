# ADR 0012: Consolidate workflow command entrypoint

## Status

Acceptance: approval and merge of the introducing PR.

## Decision

The package exposes `/workflow:config` as the single command entrypoint for companion and harness configuration. Jev routing is a row of the `/workflow:config` menu, staged and applied with the rest of the plan. Neither the former `/workflow:configure` command nor the former `/workflow:settings` command is registered. This decision consolidates command names only; [ADR 0009](0009-guided-configure.md) continues to own companion-selection behavior, and [the routing-owner specification](../specs/routing-owner.md) owns Jev routing behavior.

Supersedes: ADR-0009, only its `/workflow:configure` command name and argumentless-command clauses.

## Considered Options

- Keep separate `/workflow:configure` and `/workflow:settings` commands.
- Expose one `/workflow:config` command with a `settings` subcommand.

## Consequences

Users reach companion and harness configuration through `/workflow:config`, and reach Jev routing as a row of that same menu. The prior accepted configure behavior and the routing-owner contract remain defined by their respective authoritative documents.
