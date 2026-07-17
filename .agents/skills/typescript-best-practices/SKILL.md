---
name: typescript-best-practices
description: Apply repository-first TypeScript type-safety practices. Use when generating or reviewing TypeScript, migrating JavaScript to TypeScript, or designing typed APIs and modules.
license: MIT
compatibility: Framework-neutral; bundled analysis and generation scripts require Deno.
metadata:
  author: agent-skills
  version: "1.1"
  type: utility
  mode: assistive
  domain: development
---

# Repository-First TypeScript

Treat the repository as the authority. Existing compiler options, lint rules, tests, public contracts, and nearby code outrank this skill's defaults.

## Process

### 1. Discover

Read the applicable `tsconfig`, package scripts, lint configuration, tests, and representative neighboring modules. Identify the runtime, module system, framework conventions, and repository quality gate.

**Complete when:** each applicable source of repository policy is identified, or its absence is recorded.

### 2. Select

Choose only the branches needed for the task:

- For unfamiliar generics, mapped types, or conditional types, read [`references/type-system/advanced-types.md`](references/type-system/advanced-types.md).
- For narrowing external or unknown data, read [`references/type-system/type-guards.md`](references/type-system/type-guards.md).
- For built-in transformations such as `Pick` or `Omit`, read [`references/type-system/utility-types.md`](references/type-system/utility-types.md).
- For recoverable failures or error boundaries, read [`references/patterns/error-handling.md`](references/patterns/error-handling.md).
- For concurrency, cancellation, or async iteration, read [`references/patterns/async-patterns.md`](references/patterns/async-patterns.md).
- For immutable transformations or composition, read [`references/patterns/functional-patterns.md`](references/patterns/functional-patterns.md).
- For exports, dependency injection, or module boundaries, read [`references/patterns/module-patterns.md`](references/patterns/module-patterns.md).
- For package layout, read [`references/architecture/project-structure.md`](references/architecture/project-structure.md); for public contracts or versioning, read [`references/architecture/api-design.md`](references/architecture/api-design.md).
- For a focused review of common hazards, read [`references/anti-patterns/common-mistakes.md`](references/anti-patterns/common-mistakes.md).
- For scaffolding, type generation, or optional heuristic analysis, read [`scripts/README.md`](scripts/README.md) before running a bundled script.

**Complete when:** every task concern maps to repository policy or one selected reference; unrelated references remain unloaded.

### 3. Apply

Preserve local conventions while strengthening compile-time guarantees:

- Model domain states precisely; use discriminated unions when states require different data.
- Accept `unknown` at genuinely untrusted boundaries and narrow it before use. Use `any` only where an explicit interoperability boundary requires it, and keep that boundary narrow.
- Preserve inference inside implementations; annotate exported contracts when the repository or API stability benefits from it.
- Represent mutation and absence honestly. Add `readonly`, optional properties, or nullability only when they match runtime behavior.
- Validate external data at runtime; static types do not validate JSON, environment variables, network responses, or persisted data.
- Choose exceptions, typed results, or another error model according to local contracts and caller needs.
- Prefer the smallest abstraction that makes current behavior clear. Keep related types and behavior together unless the repository establishes another seam.
- Separate type-only imports and exports when required by the module configuration.

For reviews, report concrete correctness or maintainability consequences, cite the governing repository rule or selected reference, and label preference-only suggestions as judgment calls.

**Complete when:** every changed or reviewed public boundary, external-data boundary, state transition, error path, and module boundary has been accounted for.

### 4. Verify

Run the repository's declared formatter, linter, type checker, and relevant tests. Use bundled scripts only as optional supplements; their heuristic output is evidence to inspect, not a quality gate.

**Complete when:** the repository quality gate passes, or each remaining failure is reported with its command, location, and impact.

## Scope

This skill supplies framework-neutral TypeScript guidance. Combine it with framework-specific guidance for React, Vue, server frameworks, build tools, or runtime diagnosis.