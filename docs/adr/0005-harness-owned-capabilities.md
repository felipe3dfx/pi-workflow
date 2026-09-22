# ADR 0005: Harness-owned capabilities

## Status

Acceptance: approval and merge of the introducing PR.

## Decision

pi-workflow may own capabilities that are not companion packages. A child session and CodeGraph access are harness capabilities. `@tintinweb/pi-subagents` and `@vndv/pi-codegraph` are not expected companions. `@heyhuynhgiabuu/pi-pretty` is an expected companion and remains independently owned.

Explicit companion install and the companion catalog remain the authority for companion packages. This decision does not absorb companion source. New capability policy stays behind the extension adapter. Supersedes: none.

## Considered Options

- Keep spawn and CodeGraph as expected companions.
- Own those capabilities in the harness and add `pi-pretty` as a companion.

## Consequences

Status and doctor stop treating the removed packages as expected companions only when a later code change says so. Until then, the catalog shows the old behavior. A missing `pi-pretty` install is a degraded harness, not a silent install.
