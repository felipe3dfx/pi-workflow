# Runtime Contract

## Capability States

Each recorded capability carries exactly one state:

- `supported`: available and usable now, demonstrated only by verifiable credential-free evidence — a successful probe, or durable evidence with defined freshness criteria.
- `requires-setup`: a known mechanism exists but a nameable setup step is missing — approved configuration, installation, connection, authentication, or verification.
- `unsupported`: no mechanism is available, or a confirmed absence; optional phases may be omitted with an explicit record.
- `blocked`: an invocation outcome, not a persisted state; it applies when a skill cannot obtain required evidence and no approved degraded path exists, such as an authentication failure in this invocation.

## Domain Authority Handoff

`setup-workflow` discovers and validates map entries; `domain-modeling` selects one per invocation. A valid root `CONTEXT-MAP.md` wins: its sole `## Contexts` section links relatively to existing, contained `CONTEXT.md` files with unique case-folded labels and paths. Run the installed script as `python3 <absolute-installed-setup-workflow.py> context-map --repo <repository>` and record the map path, `DOMAIN_AUTHORITY_PATH = none (select per invocation)`, and `present (map-available)`. An invalid map blocks and never falls back. With no root map, adopt exactly one case-folded root `CONTEXT.md` as `present (root-selected)`; duplicates are ambiguous. With neither, record `docs/agents/domain.md` as `absent (fallback-required)`; its unique marker region becomes `present (fallback-established)` only when `domain-modeling` adds the first term. These states are exclusive; never repair a map, shell, marker, or handoff.

## Write Guards

The script writes a playbook only for a file the approval names, and an existing playbook only when its sections are a subset of the contract's and no recorded value becomes a marker. The rewrite replaces each contract-owned section body, so keep local text outside them. It reports the file, names the rule, and writes nothing otherwise. A malformed or ambiguous domain-authority handoff withholds `domain.md` but does not block the other playbooks. Never repair the handoff; a populated, well-formed authority region is consumer content, not shell drift. To abandon a playbook, delete it and let the next run recreate it. A path resolving outside the repository, read or written, is refused and reported. A values file the script cannot render is form drift: report it and compare by hand. Without an interpreter, perform any script step by hand and report the degraded path.
