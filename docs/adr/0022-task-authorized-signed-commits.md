# ADR 0022: Task-authorized signed commits

## Status

Acceptance: approval and merge of the introducing PR.

The contextual path remains unadopted. Production evaluation and adoption belong to #293.

## Decision

Supersedes: ADR-0020, only its worker-only, checkpoint-tool-exclusive and separate-grant permission restrictions, its universal isolated-worktree/distinct-branch prerequisites, and its conflicting reservation of otherwise task-authorized commit operations. Its signing, assigned-scope, protection of others' work and postcommit verification obligations remain.

Any child role may create a signed commit when its current task and applicable instructions authorize that action in its assigned context. An edit-only task, an offered tool or a checkpoint context descriptor is not commit authority. Commit authority does not authorize push or publication. Unclear authority, ownership or context requires consultation. Use the assigned authorized context without requiring a separate branch or worktree when there is no interference; retain isolation wherever agents could interfere.

The contextual evaluator identifies commit intent for ordinary commands and tools, not by a command inventory. Trusted task authority supplies the authorized paths and context; a classifier cannot grant these to itself. Actual local tool dispatch composes authorization with shared repository preflight and postcommit verification. The checkpoint tool is an optional scoped convenience, not the exclusive commit route. Context descriptors bind repository identity, branch and base, not permission. The existing operational path remains unchanged until adoption.

Preflight uses existing signing configuration without changing it or substituting an unsigned commit. It validates repository identity and canonical scoped paths, checks the index before any staging, and refuses uncertain scope or interference. Preserve pre-existing staged and unstaged work belonging to others; never silently stage it, clear the index, stash or reset it. Repository hooks and signing configuration still run normally. Failures are visible, not permission to bypass signing.

Postcommit verification checks the signature header, assigned paths, parent, branch and other shared refs. It reports a resulting SHA and verification failure without rewriting history or promising rollback. These checks are not atomic, do not verify signer identity, do not sandbox arbitrary tools, shell descendants or hooks, and cannot prevent concurrent external mutation. In-process competing commit calls must not spend one another's preflight evidence. Uncertain concurrent ownership requires consultation or isolation.

Preserve applicable procedure discovery, confirmations, role identity and Verdicts, destination-only Jev, instruction precedence and current-authority checks immediately before dispatch. No model, cache, inference budget, recursive delegation product, publication permission or production adoption is selected here.

## Considered Options

- Retain an exclusive checkpoint route: rejected because it makes tool availability and a separate grant competing permission authorities.
- Recognize shell command spellings: rejected because arbitrary tools and shell descendants can commit, and command text does not prove effects or ownership.
- Extend the existing contextual evaluation with explicit commit intent and trusted task scope, reusing repository verification at actual local hooks: chosen without a universal wrapper or sandbox claim.

## Consequences

Task-authorized roles can deliver signed scoped commits through supported local tools in an assigned noninterfering or appropriately isolated context. Integration and publication remain separate authorized actions. Deterministic integration tests establish mechanism behavior; real authorization accuracy and latency remain #293 responsibilities.
