# ADR 0006: Harness owns compact tool rendering

## Status

Acceptance: approval and merge of the introducing PR.

## Decision

pi-workflow renders `read`, `bash`, `grep`, `find`, `ls`, `edit`, and `write` compactly. It overrides those seven tools and delegates their execution unchanged to Pi's built-in implementations. A closed tool is one line. An open tool shows a thick left bar enclosing its title and body. Opening and closing use Pi's global expand toggle. Thinking keeps Pi's native rendering.

`@heyhuynhgiabuu/pi-pretty` is no longer an expected companion. It registers the same tool names. If it is installed, status and doctor warn about the collision and name the external removal command. The harness never uninstalls it.

Supersedes: ADR-0005, only its clause that `@heyhuynhgiabuu/pi-pretty` is an expected companion. The rest of ADR 0005 stands.

## Considered Options

- Keep `pi-pretty` as the expected companion for tool rendering.
- Own compact rendering in the harness and warn when `pi-pretty` is installed.

## Consequences

Overriding the tools makes `grep`, `find`, and `ls` active by default. A missing `pi-pretty` install is no longer a degraded harness. Per-row `Enter`, left arrow, and `Ctrl+e` bindings are not provided, because Pi has no per-row focus and reserves `Enter` for submit.

The overrides call Pi's built-in tool factories with the session working directory and read settings on each call. A session that injects its own tools or settings through the SDK loses them for these seven tools. With `--no-builtin-tools`, all seven stay active because they are extension tools.
