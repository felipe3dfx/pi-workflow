# Context

## Glossary

### pi-workflow

The coding-agent workflow harness for Pi. It coordinates the user's preferred agent workflow by relying on existing Pi packages instead of rebuilding those capabilities inside this repository.

_Avoid_: companion bundle, extension bundle, package aggregator

### Companion package

An existing Pi package that pi-workflow expects or helps install as part of the workflow harness. Companion packages remain independently owned and installed; pi-workflow does not absorb their source, internal configuration, or resources.

### Companion catalog

The curated and versioned selection of companion packages required for the complete pi-workflow harness. It is the source of truth for which external Pi packages are expected, while allowing a degraded harness when some companions are missing or mismatched. It owns expected presence and versions, not opinionated internal configuration for companion packages.

_Avoid_: companion configuration, workflow profile, package bundle

### MCP server catalog

The curated and versioned selection of MCP servers that the complete pi-workflow harness expects to be configured. It is the source of truth for expected MCP server definitions, parallel to the companion catalog: it owns which servers and definitions are expected, not how the user's environment is mutated.

_Avoid_: MCP config, mcp-servers file

### MCP configuration

The harness flow that aligns the user's MCP setup with the MCP server catalog. It plans the required changes, applies them only during an explicit companion install, and refuses to write when the user's MCP setup changed concurrently since planning.

_Avoid_: MCP setup, mcp.json editing

### Degraded harness

A pi-workflow harness state where one or more required companion packages are missing, mismatched, or unreadable. The harness may still run, and mismatches may be intentional user choices, but status and doctor flows must still make the gap explicit and guide the user back to the expected companion catalog.

### Explicit companion install

The user-confirmed action that moves a degraded harness toward the expected companion catalog. pi-workflow must not install companion packages silently during startup or inspection flows.

### Workflow profile

The opinionated operating model that coordinates pi-workflow resources and companion packages. It defines how a product idea moves through discovery, product definition, planning, construction, and verification while keeping the human authoritative over product and architecture decisions. It is separate from the companion catalog: the catalog defines which packages and versions belong to the complete harness, while a workflow profile defines how the harness behaves.

### Orchestrator

The primary Pi agent that protects its context window by retaining only product direction, routing state, gates, and compact subagent results. It decomposes work, chooses the appropriate Subagent, coordinates dependencies, validates returned contracts, and synthesizes outcomes; it does not perform context-heavy execution itself.

### Subagent

A specialized Pi agent session launched through the pi-subagents companion extension. Each Subagent has a task-specific system prompt, tools, OpenAI model, thinking level, and context contract. It performs bounded work and returns a structured result to the Orchestrator.

### Skill Registry

A recursively generated, regenerable index of available skills, their trigger descriptions, scope, and exact SKILL.md paths. It accelerates routing but is never the source of truth; each SKILL.md remains authoritative.

### Skill Resolver

The executable module that matches task intent, affected paths, and Subagent type against the Skill Registry and returns exact SKILL.md paths. Missing required skills fail delegation rather than triggering silent runtime discovery.

### Core workflow skill

A repository-agnostic skill bundled and owned by pi-workflow because it applies across the complete product-definition and delivery operating model.

### Project skill

A stack- or domain-specific skill installed into an individual repository from the separate skills catalog, such as django-expert. The Skill Resolver composes Project skills with Core workflow skills when the target repository requires them.

### Project Standards Contract

The mandatory set of project instruction paths, domain vocabulary, relevant ADRs, and Project skills resolved for a Delivery ticket. sdd-design, sdd-tasks, sdd-apply, and sdd-verify must load and apply the same contract, and report compliance in their result envelope. simplify refines compliant work; it is not a repair step for missing standards.

### Workflow Artifact Interface

The restricted interface through which a Subagent reads explicitly allowed artifact references and writes only the Engram topic owned by its phase. It prevents broad memory search, cross-phase overwrites, and arbitrary observations while allowing durable artifacts and checkpoints.

### Delegation checkpoint

A durable progress record containing the delegation identity, task fingerprint, Subagent session identity, completed work, and next resumable step. Long-running phases checkpoint by batch; short phases persist their final artifact once.

### AI product-development operating system

The product identity of pi-workflow: a coordinated system for moving from an ambiguous product idea to a constructed and verified solution. Humans lead product and architecture decisions; agents investigate, plan, execute, and review within explicit boundaries.

_Avoid_: prompt collection, autonomous developer, agent bundle

### Owner

The person who defines and evolves the operating model, mandatory policies, and default behavior of pi-workflow. The Owner is the final authority over how the system works; the initial Owner is Felipe.

### Developer

A person who uses pi-workflow under the operating model established by the Owner. Developers can provide product context and make decisions delegated to their role, but they do not independently redefine harness behavior.

_Avoid_: end user, team member, team operator, harness administrator

### Product definition moment

The first operating moment. The Owner initiates an idea, clarifies it into a product Spec, and then decomposes it into actionable Linear tickets. It ends when the work is ready for the Owner to assign to Developers.

### Delivery execution moment

The second operating moment. A Developer executes the remaining SDD workflow against a Linear ticket assigned by the Owner and committed to the current Cycle. It ends by posting a Linear handoff comment that asks QA to review the result before Product review.

### Wayfinder artifact

A discovery artifact persisted in Engram while the Owner clarifies an idea before the product Spec. It may contain the map, a resolved decision, research, a prototype, or grilling context. Wayfinder artifacts never become Linear issues; relevant artifacts are exported as supporting documents on the Delivery parent when the Spec is created.

### Delivery parent

The Linear parent issue that is the canonical product Spec and represents the complete expected outcome. Its description holds the Spec, its workflow state communicates overall progress, and it owns the Delivery tickets required to fulfill it. No separate Linear Document duplicates the Spec.

### Delivery ticket

A Linear subissue of a Delivery parent. It defines an atomic, deliverable, and verifiable implementation unit. Delivery tickets are normally assigned with their parent to the same Developer and are executed individually through SDD before the complete Delivery block enters synchronized review.

_Avoid_: task ticket, implementation task

### Delivery block

A Delivery parent and all of its Delivery tickets coordinated toward one product outcome. One Developer normally owns the whole block. Delivery tickets may be implemented, reviewed, tested, and delivered independently, while the parent waits at each synchronization barrier. QA may test subissues as they arrive; only after every subissue and the parent pass QA does the complete block advance to Product screening.

### Assign To label

A Linear group label whose selected Developer identifies the Delivery ticket's stable end-to-end responsible person until Done. It does not change when the issue assignee changes during review, QA, or Product gates.

### Current assignee

The Linear assignee responsible for the Delivery ticket's immediate next action. Unlike the Assign To label, this field may change throughout the Quality loop.

### Delivery estimate

The Owner's expected implementation time for a Delivery ticket, recorded in Linear's native estimate field when the ticket is created. The allowed scale is 1–8 points, where one point equals one hour.

### QA estimate

The expected time QA needs to review a Delivery ticket, recorded separately through the Estimacion QA Linear group label before Cycle commitment. The allowed scale is 1–8 points, where one point equals one hour of QA work.

### QA handoff comment

A Linear comment generated on every Delivery parent and Delivery ticket only when the responsible Developer explicitly invokes the designated handoff skill after that issue's change is approved, integrated, and available in the QA environment. It gives QA the scope, acceptance criteria, evidence, and verification guidance needed to review the issue.

### QA review comment

QA's review record on every Delivery parent and Delivery ticket. It captures the observed result and supporting evidence for approval or rejection before the issue advances or enters Stop.

### Product screening comment

PS's review record on every Delivery parent and Delivery ticket. It captures product-screening findings and the reason the issue advances to Owner review or enters Stop.

### Product review comment

The Owner's final review record on every Delivery parent and Delivery ticket. It captures product acceptance evidence or the reason the issue enters Stop.

### QA review

The verification gate after Delivery execution. QA may evaluate Delivery tickets independently as they become available, using their QA handoff material. The Delivery parent remains at the QA barrier until every subissue and the parent have passed; QA then advances the complete block to Product screening.

### Product screening

The first product-facing gate after QA approval, represented by Ready for PS. Product screens and prepares the Delivery block so the Owner receives a filtered review queue. This step may gain AI assistance in the future but is currently human-driven.

### Product review

The Owner's final product-facing gate, represented by Ready for PO. It evaluates whether the complete Delivery block fulfills the intended product outcome rather than repeating implementation verification. The Owner moves the approved block to Done.

### Quality loop

The rework cycle available from any review stage. A reviewer moves the affected Linear issue to Stop and returns it to the responsible Developer with feedback; after adjustment, the affected implementation repeats the required review flow while the Delivery parent waits at the synchronization barrier.

### Harness release guard

The validation policy that protects pi-workflow releases. It validates package publish readiness and harness decisions, including exposing only pi-workflow-owned resources, not re-exporting companion resources, not bundling companion packages, and keeping the companion catalog as the source of truth.

### Workflow helper extension

The Pi extension owned and exposed by pi-workflow. It is the adapter from pi-workflow domain concepts into Pi commands, while companion resources remain exposed by their own packages rather than through the pi-workflow package manifest. Its public interface is status, doctor, and explicit companion install; harness policy should live behind it rather than inside the adapter.

_Avoid_: harness policy owner, companion resource exporter

### Harness doctor

The diagnostic flow for the pi-workflow harness. Today it diagnoses companion package state; over time it should remain the general harness diagnosis interface as new harness concepts appear. It differs from status by depth: status is a short actionable summary, while doctor provides extended diagnostic detail.
