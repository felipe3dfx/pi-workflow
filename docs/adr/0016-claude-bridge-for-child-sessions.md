# ADR 0016: Claude Bridge extends the curated child sessions

## Status

Acceptance: approval and merge of the introducing PR.
Superseded by [ADR 0023](0023-children-run-as-rpc-processes.md), which carries its Claude Bridge resolution and failure constraints forward for children that run as RPC processes.

## Context

ADR 0014 keeps Specialists in the parent's Pi process and gives each child a curated extension set. Claude Bridge is an independently installed official Pi extension that registers the `claude-bridge` provider. A child selecting one of its models needs that provider resource in the child session as well as the parent's already loaded provider runtime.

## Decision

Supersedes: ADR-0014.

All decisions in ADR 0014 remain in force except that a child selected for Claude Bridge receives the single official Claude Bridge extension resource described here in addition to the existing curated extensions. Children remain in-process and carry the parent's risk. Their Contract, role context, tool projection, model/thinking inheritance, result delivery, MCP trust, optional Explorer web behavior, lifecycle, cancellation, and continuation do not otherwise change.

Pi's normal package configuration loads the official extension in the parent. A child loads that extension only when its selected model provider is exactly `claude-bridge`; a native-model child does not load it. Resolve the configured, installed package with Pi's package manager using the parent's `cwd` and project-trust decision, honoring Pi's project/user precedence, configured source identity, and extension filters. Identify the official package by its installed metadata (`pi-claude-bridge`, repository `elidickinson/pi-claude-bridge`) and select only its manifest-declared provider extension resource. Do not inspect the child's worktree configuration or substitute parent package settings into the child's loader.

Pass the verified absolute extension file through Pi's public `additionalExtensionPaths` option while retaining the child's in-memory settings and curated inline extensions. Load the extension resource before session creation; bind and start its handlers inside the child's run before its first prompt. Keep the child's Contract and role-specific context and tool projection; AskClaude is not added to the child's tools. A missing, ambiguous, filtered, unreadable, or invalid provider resource is a visible failure. Resolution does not install packages, load a different provider, or fall back. An explicitly selected model absent from Pi's available-model catalog is refused before child launch.

## Consequences

Claude Bridge children use the same process, filesystem, credentials, and network access as their parent. The official extension does not add an operating-system boundary. Non-Bridge children retain the current extension behavior, and the existing MCP, optional Explorer web, Contract, and child-session lifecycle decisions remain unchanged.
