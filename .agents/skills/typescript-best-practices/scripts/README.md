# Bundled scripts

These Deno scripts are optional utilities. Run them from the skill directory, grant only the permissions shown, and inspect generated changes before keeping them. Repository-native checks remain authoritative.

## Analyze TypeScript

Use `analyze.ts` for a heuristic scan after repository checks have been identified:

```bash
deno run --allow-read scripts/analyze.ts <path> [--strict] [--json] [--fix-hints]
```

Treat every finding as a review prompt rather than a violation; regex-based analysis cannot understand repository intent or the full TypeScript program.

## Generate types from JSON

Use `generate-types.ts` when representative JSON is available:

```bash
deno run --allow-read scripts/generate-types.ts <input> \
  [--name <name>] [--readonly] [--interface] [--output <path>]
```

Add `--allow-write` only when using `--output`. Validate generated types against the real external-data contract and add runtime validation where the data is untrusted.

## Scaffold a module

Use `scaffold-module.ts` only when its shape matches neighboring modules:

```bash
deno run --allow-read --allow-write scripts/scaffold-module.ts \
  --name <name> [--path <directory>] [--type service|util|component] [--with-tests]
```

Review all generated files and adapt them to repository naming, exports, testing, and module-boundary conventions.
