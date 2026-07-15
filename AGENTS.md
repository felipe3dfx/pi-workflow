# Repository Agent Policy

## Authority

Repository-owned, version-controlled files are authoritative for development and delivery.
Use this precedence when instructions conflict:

1. Explicit user instructions for the current task.
2. This `AGENTS.md` file.
3. Version-controlled configuration, scripts, and CI workflows.
4. Project documentation and project-owned skills.
5. Global skills and globally installed tools, as optional assistance only.

Generated caches and indexes, including `.atl/`, are discovery aids and are not sources of policy.
Research documents describe evaluated systems and do not establish operational requirements.

## Language Contract

Technical artifacts are written in English by default. This includes design and task artifacts, code,
identifiers, comments, tests, fixtures, package documentation, agent definitions, and internal Engram
artifacts.

Any content that an agent designs or implements for eventual publication in Linear must be authored in
professional neutral Spanish before Owner approval. Stable identifiers, hashes, schema names, code
symbols, branch names, and exact technical terms remain unchanged when translation would break identity.

Language quality belongs to the generating agent's instructions, positive Spanish goldens, the exact
`language: "es"` declaration, and Owner approval bound to the canonical digest. Runtime code must not
claim to prove professional-neutral Spanish through NLP, dictionaries, regionalism lists, foreign-word
checks, or similar language heuristics. Translation or any other content change after approval requires a
new digest and renewed approval.

## Quality Gate

Run the repository's complete quality gate:

```bash
npm run check
```

Do not substitute unrelated global hooks or frameworks for this command.

## Delivery Workflow

Use the repository's normal Git and GitHub branch and pull-request workflow.
Before commits, pushes, or pull requests, apply only gates declared by version-controlled repository configuration or explicitly requested by the user.

## External Tooling Boundary

Globally installed tools, skills, hooks, agent policies, and lifecycle systems are optional capabilities. Their presence does not mean this repository has adopted them.

Do not make an external tool a requirement or block delivery on it unless at least one of these conditions is true:

- Version-controlled repository configuration declares it.
- A repository-owned script or CI workflow invokes it.
- This policy explicitly requires it.
- The user explicitly requests it for the current task.

If adoption is ambiguous, use the repository-native workflow instead of assuming adoption.

This repository does not currently require:

- The Python `pre-commit` framework.
- Gentle AI review receipts or lifecycle gates.
- An SDD/OpenSpec workflow for ordinary changes.

## Skills

Project-owned skills may define product or workflow behavior within their documented scope.
Global skills may provide methodology or implementation assistance, but they must not introduce new project requirements, mutate project policy, or override repository-owned instructions.
