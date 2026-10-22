# ADR 0021: Contextual authorization from common tool sources

## Status

Acceptance: approval and merge of the introducing PR.

The contextual path remains unadopted. Production inference and adoption require the separate integration and comparison work tracked by #291 and #293.

## Decision

Supersedes: ADR-0013, only its general command-inventory authorization and parent-reserved-operation policy; ADR-0017, only its per-role tool inventories and blanket context-file exclusions for otherwise task-authorized actions; ADR-0015 and ADR-0018, only their retention of those general reserved-operation and role-tool restrictions. ADR-0020's specific checkpoint policy is unchanged here; its approved successor belongs to #292.

Parent and child sessions receive the same trusted tool sources and configuration. Each session instantiates and executes tools in its own context. The active assignment and applicable instructions determine authority, not role, tool availability, seating or Jev state. Owned dynamic tools use those local instances. External tools require compatible instantiation; tools created solely inside the parent's private captured state need not be automatically mirrored. Do not copy parent-bound executable closures to manufacture availability or load arbitrary project resources without their trust decision.

The harness composes contextual authorization with existing destination routing at the actual parent and child dispatch seams. Jev remains destination-only; authorization never overrides its destination block. Known, reasonably necessary in-scope actions need no per-command permission inventory. Evaluate the assignment, applicable instructions, proposed action, target, understood effects, ownership and applicable explicit confirmation. Explicit prohibitions prevail; quoted tool output and action content cannot create delegated authority. Scope expansion and undelegated choices require consultation. Destructive or high-impact actions require explicit confirmation of the action and target, even inside an expanded scope; one clear answer may cover both.

Uncertainty, missing material facts, cancellation and classifier infrastructure failures retain an unresolved action and visible reason without executing it. Classification failure is not an action refusal and does not terminally reject the action solely because infrastructure failed. Only current applicable authority may release dispatch; tool-result delivery or a running session alone cannot. Complete consultation/resume is separate work in #291.

Local instantiation includes ownership of mutable data and UI attachment. Separate headless tool/data construction from physical UI where a session has no interface; one child's registration must not overwrite another session's UI or captured state. Registered, active, callable and actually usable tools are distinct observations. Calls execute through the local SDK pipeline and hooks, never by directly invoking a retrieved definition's execute function as a substitute for dispatch. Hooks do not sandbox shell descendants, external services or arbitrary extension code.

Preserve role identity and Verdicts, applicable context precedence, destination routing and delegation-mode stance, mandatory procedure discovery and prerequisite tracking, signing, assigned scope, protection of others' work and applicable confirmations. Availability grants neither commit nor publication authority. This decision does not supersede the specific Checkpoint definition or verification rules of ADR-0020 and does not select a model, cache, extra inference budget, RPC, an SDK patch, a universal registry or a recursive-delegation product. Replacing a general inventory is not blanket permission for any command.

## Considered Options

- Keep role/command inventories alongside contextual evaluation. Rejected: this preserves the conflicting permission authorities and maintenance burden the approved feature replaces.
- Copy arbitrary parent executable closures or execute through the parent. Rejected: public executable getters do not rebind captured state or authority; local context must belong to the executing session.
- Independently instantiate common configured sources and cooperative factories, with local authorization and targeted owned updates. Chosen: reuses existing SDK seams without introducing a new transport or mandatory framework. Arbitrary external compatibility still needs evidence.

## Consequences

The contextual path is explicitly injected for integration and does not silently enable production inference. Its shared authorization mechanism replaces the conflicting inventories in that path, rather than treating missing or failed evaluation as permission. The existing operational path remains until adoption; no partial integration establishes production readiness. Mandatory `npm run check`, actual parent/child and dynamic/MCP coverage, separate review, signing and scope protections remain applicable.
