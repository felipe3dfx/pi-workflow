# Contextual action authorization

Status: READY WITH WARNINGS — authoritative technical specification; publication and implementation are separate delivery stages.

## Package identity and reading contract

This is the single complete English technical specification for the current execution-scoped definition. It records the authoritative proposed behavior, not evidence of completed publication, approval to implement, or production permission.

- Source brief: [stable functional brief](../features/contextual-action-authorization.md), SHA-256 `be690abb770e27c58e651cf85fd142d55dacd86d6e713a47fe5c36d6e11607b2`.
- Current review handoff and final feature-critic report: [stable functional review](../features/contextual-action-authorization-review.md), section **Captura final renovada — deltas de commits y contexto**, SHA-256 `289bd81c0893f8b1eeb8a2d2a32bed421ce2bfdaa3a19af5d93c8bd5ef4992f9`. Earlier captures in that report are history, not the current package. The parent supplied the renewed three-lens consolidation; synthesis does not perform another review.
- Specification identity: `docs/specs/contextual-action-authorization.md`; consolidated technical review: [specification review](contextual-action-authorization-review.md). These destinations identify distinct artifact roles; this text does not attest their publication or read-back.
- Separate joint feature publication roles: stable brief `docs/features/contextual-action-authorization.md` and exact stable feature report `docs/features/contextual-action-authorization-review.md`. The consolidated technical review does not replace or duplicate that functional review.
- Authority: `AGENTS.md`, `docs/agents/workflow.md`, `domain.md`, `quality.md`, `coding-standards.md`, `GLOSSARY.md`, ADRs 0013, 0015, 0017, 0018 and 0020. Current operational authority remains unchanged. The generated Domain Authority Handoff and its read-only authority review are separately absent: two admissible evidence gaps, not generated or substituted by this specification. The closed functional/semantic decisions and renewed disposition permit synthesis under `to-spec`.

Read sections 2–5 for required observable behavior; sections 6–9 for recommended implementation and verification; sections 10–12 for evidence, adoption and handoff. **Mandatory** means an accepted user decision, applicable canon or indispensable dependency requires it. **Recommendation** means a supported structural choice, not newly binding product behavior. Paths describe inspected seams, not permanent implementation prescriptions.

## 1. Problem and intended outcome

Command inventories and role-specific tool restrictions interrupt legitimate delegated work and require recurring maintenance. Adding a classifier while keeping the replaced inventories would retain that burden and create competing authorities.

Replace the conflicting restrictions with contextual evaluation of the assignment, instructions, proposed action, target and effects. Parent and child sessions have the same tools available; authority comes from the task and applicable instructions, not tool availability, role or Jev routing state. Reasonably necessary in-scope work is implicit. Scope expansion, undelegated decisions, uncertainty and high-impact actions require the appropriate consultation before execution.

This is an authorization change, not a new destination router, generic sandbox, recursive delegation product or workflow engine. Existing procedural obligations, signing, protection of others' work and applicable confirmations remain except for the explicitly approved supersessions.

## 2. Decision and supersession ledger

The user is the resolver of every approved functional decision below. The source is the current discovery conversation as preserved in the exact brief sections named here; synthesis translates intent without creating an approval timestamp or a new resolver. All constraints in this table are mandatory for the proposed feature, not permission to bypass today's rules.

| Decision / status | Source and reason / scoped effect |
| --- | --- |
| Shared tool availability; confirmed | `User-confirmed behavior`: remove role/tool availability as authority proxies. Same availability is not blanket permission. Do not invent tool-parity exclusions or interpret parity as approval to build recursive-child management. Roles may still guide work and Verdicts. |
| Necessary in-scope steps implicit; confirmed | `User-confirmed behavior`: authorize ordinary means of fulfilling an assignment without command enumeration. An explicit prohibition or undelegated decision is not erased by usefulness to the goal. |
| Expansion and high-impact confirmation; confirmed, prior warning corrected and reverified | `User-confirmed behavior` and renewed report: expanding scope does not replace specific explicit confirmation of a destructive/high-impact action and target. One clear response may approve both; requiring two consultations is not approved. |
| Escalation and classifier failure; confirmed | `User-confirmed behavior`: child → parent → user when unresolved. Failure/unavailability yields no automatic execution and no terminal rejection merely because classification failed. |
| Jev destination only; confirmed / canon preserved | `User-confirmed behavior`, ADR 0017: Jev chooses destination, not authority, tool permissions or Specialist. Authorization works on/off; equivalent authority and actions have equivalent outcomes. |
| Any task-authorized child may commit signed changes; `approved delta`, renewed review complete | `Approved child-commit delta`, user’s “Si” accepting the transcribed recommendation. Replace worker-only, checkpoint-tool-exclusive and separate-grant-as-permission restrictions of ADR 0020. Preserve signing, assigned scope, other people's work and applicable confirmation. An edit-only task or offered tool does not authorize commit or publication. |
| Assigned authorized commit context; `approved delta`, renewed review complete | `Approved commit-context isolation delta`, user's explicit approval of the transcribed recommendation. Replace isolated worktree/distinct branch as universal child-commit prerequisites; retain isolation where agents could interfere. Not a general isolation waiver. Unclear context or authority escalates. |
| Both prototypes `reference-only`; accepted | `Accepted prototype evidence`, explicit user acceptance: retain observations as evidence, not implementation bases or authorization mechanisms. |
| Integration risk `risk accepted`, definition only | `Accepted residual risk — definition only`, explicit user acceptance: continue definition despite missing real integration. Does not approve production or permanently waive verification. |
| Adoption parameters open; deliberately deferred | `Open adoption decisions and risks`: compare model/context alternatives using latency and authorization errors. No production adoption, numeric latency/accuracy target, model, cache or extra inference budget chosen. These are evaluation decisions, not missing functional behavior. |

Proposed supersessions are scoped: ADR 0013 command-based child restrictions and ADR 0017 role-specific tool restrictions where they conflict; ADR 0020 role/tool/separate-grant exclusivity and universal worktree/branch prerequisites as stated above. Preserve destination-only Jev, applicable procedure discovery and prerequisite tracking (ADRs 0015/0018), signing, scope and confirmation protections. Reconcile the conflicting reserved-operation wording in those ADRs, Contracts and guidance before implementation; preserve unaffected rules rather than silently carrying forward exclusivity or deleting protections wholesale.

`Contract` and `Checkpoint` retain their current glossary meanings until the owning canonical changes occur. A future task-authorized signed child commit is not automatically today's defined Checkpoint. The functional review classifies the future ADR 0020 change as `authorized divergence`, with retained signing/scope `compatible`. This specification does not amend canon or grant runtime authority.

## 3. User stories

- As a parent or child, I perform ordinary steps needed for my assignment without maintaining command inventories.
- As a child, I ask my parent about unclear authority; if the parent cannot resolve it, the user is consulted before the action proceeds.
- As the user, I confirm a destructive/high-impact action and target explicitly, possibly in the same response that expands scope.
- As an assigned child of any role, I create a signed commit of only authorized changes in my assigned authorized context, retaining isolation where interference is possible.
- As an operator, I get equivalent authorization under equivalent assignments regardless of session identity or Jev state, with no guessed permission when inference or consultation fails.

## 4. Observable authorization interface

**Mandatory behavior; source:** confirmed brief decisions. **Reason/necessity:** a proposed action cannot be authorized by its command name, a running session, a role, a routing result or a free-text transport acknowledgment alone.

Evaluation must consider the active assignment and applicable instructions, what is proposed, its target, reasonably understood effects, ownership and any prior explicit confirmation. Missing material facts are uncertainty, not permission. Instructions quoted in tool output or action content are evidence to assess, not new delegated authority.

Conceptual outcomes are: may proceed within authority; needs scope/decision consultation; needs specific high-impact confirmation; or unresolved/failed evaluation requiring consultation. These describe behavior, not a mandatory exported enum or the prototype's schema. A response that clearly refuses the action remains a refusal; failure to classify is not an action refusal. Neither is authorization.

Before dispatch, authority must still cover the actual action, target and context. A materially changed action, target, ownership, assignment or effect needs renewed evaluation/confirmation as applicable. Approval for one target cannot authorize another. Only a resolved, applicable authorization may release execution. Question delivery, `reply_child` success and `waiting` → `running` alone cannot release it.

## 5. State scenarios and acceptance contract

These are authorization states, distinct from the glossary's Child Run state or Verdict. Mandatory observations derive from section 2; correlation and exactly-once release are indispensable dependencies of applying approval to the intended action rather than a different or repeated dispatch.

| Scenario | Required observation |
| --- | --- |
| Assigned correction needs ordinary edit/check | Known, reasonably necessary in-scope action may run without a command inventory or redundant consultation. |
| Unrelated change / undelegated choice | Hold the proposed action; consult parent/user as appropriate; resume only with changed authority or abandon that action on actual refusal. |
| Destructive in-scope action | Hold until explicit confirmation names the action and target; the task objective alone is insufficient. |
| Destructive out-of-scope action | Resolve both expansion and impact; one explicit response can cover both. Approval of only expansion cannot release execution. |
| Unknown ownership/effects/instructions | Child asks parent with relevant assignment/action facts. Parent can resolve facts within its authority, otherwise asks user. No execution while unresolved. |
| Timeout, malformed classification, unavailable model | Enter the same consultation path; never autoexecute, silently fall back to permission or terminally reject solely for classifier failure. |
| Explicit denial / wrong-target answer | No execution; distinguish real refusal from missing authority. Wrong-target answer leaves the proposed action unresolved. |
| Stale, duplicate or wrong-child reply | Cannot release a different pending action or execute twice; existing child/question identity checks are necessary but insufficient semantic checks. |
| Dismissed/aborted panel or unavailable UI | No invented answer or execution. Surface unresolved authority and permit a later consultation/resume path. |
| Delivery failure / cancellation during wait | No execution. Report that consultation did not establish authority; cancellation is not consent. A retry/resume must use current facts and identity. |
| Foreground child needs parent | Existing ask refusal must not become permission or a dead end for authorization. Return/retain unresolved action information for parent consultation and later authorized continuation. |
| Same action, same authority, parent/child × Jev on/off | Equivalent authorization semantics; routing may change destination, not permission. |
| Child commit expressly assigned | Any role can create signed scoped commit in authorized assigned context; protect others' work and isolate when interference is possible. No independent role/tool/grant veto. |
| Edit-only child / unclear commit context | No commit based on tool availability. Consult when commit authority/context is unclear. Commit permission does not imply push/publication. |

## 6. Existing seams and coverage limits

CodeGraph was consulted before broad source discovery: queries `childBash`, `checkpoint`, `tool_call` and `ask_parent`, followed by exploration of `createChildBashTool` and `createChildLauncher`. `tool_call` had no symbol match; targeted source inspection then established the real hook. Generated indexes are discovery aids, not authority.

| Existing seam / evidence | Technical implication |
| --- | --- |
| `extensions/child-launcher.ts`: `gateToolCall`, `childToolsOffer`, actual `pi.on("tool_call", …)` | Highest useful existing parent interception seam. Currently a destination gate conditional on seating, `gatedTool`, latest request and routing state; not complete authorization for all tools. It allows non-gated calls, and a launch can release gated parent tools for the message. |
| `extensions/child-sessions.ts`: `createPiChildSession`, `childTools` | Highest useful child construction seam: role Contract tools plus runtime MCP patterns, explorer web tools, ask/report and optional checkpoint; custom bash/CodeGraph and codemode/MCP factories are installed here. Parent hook registration alone does not prove child coverage. |
| `extensions/child-bash.ts`: `createChildBashTool`, `guardPrefix` | One actual shell guard implementation. Replace conflicting command allowlists rather than leaving them as a second permission policy. ADR 0013 explicitly acknowledges descendant/absolute-path/env bypasses; not a sandbox. |
| `extensions/child-checkpoint.ts`: `checkpointGrant`, `createCheckpointTool`; launcher grant checks | One checkpoint implementation. Reuse signing/scope verification where useful, but remove approved exclusivities/universal isolation assumptions. Fleet broker is a shared caller, not a second sibling implementation. |
| `extensions/child-sessions.ts`: `ask`, `answer`, `sessions.reply`, query tools | Existing correlated child question, waiting and reply seam. Checks child/question identity, not authorization semantics. Foreground branch explicitly rejects asking because parent waits for child. |
| `extensions/ask-user-panel.ts`: `askPanel` and choice/question tools | Existing operator transport; returns refusal for no TUI/print, abort or dismissal rather than inventing consent. This is not proof of a human authorization protocol. |
| Pi codemode/MCP factories and nested events | Calls may be nested, deferred, concurrent or dynamic; relevant to coverage and child registration, not just outer wrapper classification. `parentToolCallId` in the existing hook is evidence of nested-event handling, not proof every executor is intercepted. |

**Mandatory scope of guarantee:** establish authorization before each supported action dispatch through the covered harness execution paths, with unresolved actions never dispatched. A top-level shell invocation may contain effects not independently observable as tool calls. Hooks, descendant processes, external services, provider cancellation and tools ignoring abort are not newly sandboxed. Describe and test the actual observed interception coverage; do not claim universal all-tool, process or transactional isolation from this event hook.

## 7. Recommended deep module and implementation decisions

Each row is a structural choice with evidence, reason and necessity. Recommendations are deliberately not prerequisites invented by synthesis.

| Choice / necessity | Evidence and reason |
| --- | --- |
| **Recommendation:** one deep authorization module behind a small interface at existing interception/child-construction seams | Parent hook and child factory already concentrate dispatch/construction. Hide context assembly, classification interpretation, consultation correlation and release checks together for depth, locality and leverage instead of reimplementing policy in each tool. Conceptually evaluate a proposed invocation against current authority, retain unresolved consultation, and return a resolved dispatch decision. This is an illustrative interface, not fixed method names or schema. |
| **Mandatory:** child and parent observable parity; **recommendation:** reuse that module at child registration as well as parent interception | Brief requires equivalent authority semantics. Current child resource loader installs its own extensions/custom tools and no general inherited parent policy. Explicitly wire both; preserve role selection and context precedence without deriving permission from role. |
| **Mandatory:** retain Jev's destination meaning; **recommendation:** compose independent routing and authorization decisions at the existing hook | ADR 0017 and accepted brief preserve routing. A `stay` or post-launch release cannot authorize an action, and authorization cannot override a destination block. Keep routing failures distinct from contextual authorization failures. |
| **Mandatory:** account for nested codemode and MCP action dispatch; **recommendation:** reuse observable nested invocation hooks, with focused SDK integration tests | Existing child factories, wildcard MCP registration and nested call IDs show real paths beyond plain bash. Outer-wrapper approval alone cannot prove the inner action/target/effects. Verify direct and deferred tools, resources and nested failures before claiming coverage. Avoid a duplicate per-command inventory. |
| **Recommendation:** keep inference and transport as injected internal seams | Model runtime and question/reply depend on SDK/external inference; deterministic doubles and real transports both exist. Production inference and test doubles justify adapters. Keep classifier model/configuration choice open; do not expose internal adapter complexity to every caller. |
| **Mandatory:** preserve action-target authority through pending/resume; **recommendation:** use existing ask/reply, pending-result and continuation seams | Existing transport correlates child/question, not action semantics; isolated experiment proves this gap. Retain assignment, action, target and unresolved reason across handoff and re-evaluate applicability before one dispatch. Exact record schema/storage/lifetime is not a product decision here. |
| **Mandatory:** handle foreground and no-UI without automatic execution or terminal failure solely from infrastructure; **recommendation:** report pending authority to parent, consult through an available parent/user channel, resume through existing continuation | Current foreground refusal says “Continue without an answer”; no-UI panel refuses. For an authorization-dependent action that instruction must mean continue only independent authorized work, never the held action. A parent-visible unresolved result and follow-up continuation avoid changing foreground into background or inventing UI consent. Do not retry indefinitely or claim persistence across restart without evidence. |
| **Mandatory:** any task-authorized child commit remains signed/scoped and interference-safe; **recommendation:** deepen existing checkpoint verification rather than duplicate it in role handlers | Approved deltas plus existing signer, path/index and postcommit checks justify reuse. Keep protection of others' work even in an authorized shared context; retain isolation where interference can occur. Reusable verification must not recreate checkpoint-only permission. Preserve applicable hooks/procedural protections. |

No model, provider, cache, global registry, new coordinator, new package or second prototype is structurally indispensable at definition time. Avoid shallow wrappers whose interface merely mirrors all classifier or transport details. Use the module's small interface as the test surface; keep SDK details in adapters and local state internal.

### Foreground/no-UI completeness and unresolved-choice policy

The approved behavior is closed; automatic approval and permanent refusal caused solely by unavailable classification/transport are excluded. The existing transports do not yet implement the recommended authorization pending/resume behavior. This is implementation work and an adoption evidence gap, not a claim that the prototype solved it.

The recommendation does not prescribe new durable persistence, a new non-TUI panel or automatic foreground-to-background conversion. Source precision: existing `continue_child` applies only to completed, retained background sessions; it is not existing foreground recovery. The recommended follow-up continuation is a direction for integration verification, not a claim that this tool already solves foreground recovery or a newly selected transport design. If real SDK integration cannot return an unresolved action to the parent and continue after consultation using existing mechanisms, the resulting choice of new transport or changed session behavior is material: present the failing foreground/no-UI trace and constraints to the developer, resolve within canon, and return a material definition change to feature-critic. No such new product choice is selected here; no currently undisposed blocking definition finding is asserted.

## 8. Dependencies and native relationships

**Mandatory dependencies; reason:** runtime behavior relies on the installed Pi SDK (`@earendil-works/pi-coding-agent`, `pi-ai`, `pi-tui`, currently pinned 1.0.4 for development), tool-call hook semantics, nested IDs/events, resource loading, active tools, parent delivery and child continuation. Validate their actual behavior rather than assuming a security interceptor from the type names. Inference is a true external dependency; SDK transport is an external implementation dependency; child/question core is in-process; temporary Git/worktree and MCP fixture processes are local-substitutable dependencies.

Native relationships constrain implementation order, not ticket count:

1. Reconcile ADR/Contract/glossary conflicts before enabling changed operational policy. Procedure discovery and prerequisite tracking must account for signing, confirmation and scope obligations.
2. Establish a reusable authorization interface and parent/child integration before removing the old restrictions in a production-enabled path; do not ship a permission gap or keep the replaced inventory as the finished solution.
3. Transport/correlation and pending/resume handling precede claims of real action authorization, including foreground/no-UI failure paths.
4. Dynamic tool registration, codemode nesting and direct/deferred MCP require joint coverage tests with the shared module; parent-only tests cannot establish parity.
5. Child commit policy requires coordinated launcher, Contracts, shell guard and checkpoint-verification reconciliation. Preserve unrelated destination routing, result delivery, role identity and context-loading behavior.
6. Real end-to-end integration and measured error/latency comparison precede production adoption, not technical definition. Publication and ticket slicing are separate parent-owned stages.

## 9. Test decisions and completion evidence

**Mandatory outcomes** are the scenario observations in section 5 and shared invariants in section 12, derived from approved behavior. **Recommended test structure** uses highest useful existing seams: parent registered tool-call handlers and child construction/real SDK sessions, not tests of a disconnected classifier alone. This gives leverage and catches missing wiring. Use `test/support/README.md` helpers before creating new helpers: isolated agent directories, fake children/Jev, real child sessions, MCP fixture subprocesses and temporary Git repositories. Inference adapters can be scripted; label scripted results as doubles.

Recommended verification layers:

- Deterministic authorization cases cover necessary in-scope work, explicit prohibitions, scope changes, impact, unknown effects/ownership, malformed/failed inference and quoted instruction injection. Test changed assignments/targets and stale approvals. No numeric accuracy promise follows from unit tests.
- Registered parent-hook tests preserve destination semantics and prove authorization still applies after `stay` or launch-based gate release, with Jev on/off. Test non-gated existing tools so omission is visible rather than reporting a false all-tool guarantee.
- Real child construction tests compare observable tool availability and authorization across all roles, parent/child and Jev contexts. Include custom tools, direct/deferred MCP, nested codemode, cancellation and sibling concurrency. Check exactly which calls reach interception, including nested IDs and failure propagation.
- Transport integration tests assert child question → waiting → parent reception → parent resolution or user consultation → correct reply → applicability recheck → at most one action execution. Assert zero executions at every unresolved boundary. Cover foreground rejection recovery, no UI, dismissal, abort, delivery failure, wrong child/number/target, duplicate replies and continuation with changed facts. Real SDK scheduling, parent reasoning, human interaction and actual authorized actions must be demonstrated before adoption; the existing simulated executor is insufficient.
- Commit tests cover each role, expressly authorized and edit-only tasks, configured signing failure/success, scoped paths, other people's staged/unstaged changes, shared assigned context without interference, and contexts requiring isolation. No role/tool/separate grant may be the permission proxy. Preserve error reporting when postcommit verification discovers a problem; do not invent rollback or cryptographic identity verification beyond evidence.
- Run repository-native `npm run check` on implementation changes and record exact results. Hidden prototype tests are not part of that glob; their preserved evidence is not regenerated for this documentation synthesis. Mutation testing is unsupported by `docs/agents/quality.md`, not a new gate.

Before production adoption, use representative and adversarial assignments, independently reviewed expected authority, real tools and complete escalation. Compare alternative model/context configurations with false permissions, unnecessary escalations, failure rates, latency distribution and workflow-level accumulated delay. Agree numeric accuracy/latency criteria from measurements with the user. A measured comparison and real integration are required by the accepted risk; a mandatory additional prototype, model or cache is not.

## 10. Prototype disposition and evidence limits

Both dispositions were explicitly accepted by the user and remain **reference-only**. No prototype code is adopted or imported into production.

1. `.agents/prototypes/action-classification/README.md` and `evidence/`: one model, 16 synthetic cases × four parent/child and Jev contexts, 64/64 expected labels, zero false permits and invariant labels in the preserved run. Mean 3.31 s/action; p95 6.20 s. These are an exploratory author-labeled corpus and one run, not a general safety estimate, adopted target, model selection or live action authorization. Live evidence SHA-256 `cd4166ba2a775d0180736f3114353371baa57ab412b7aeb61ffd11315d12d68b`; evaluation `b0e176b40fc2d918f67e0b44ee396cfff0e4c0cdc4ca8b38e917197fb532b50b`. No inference rerun is authorized here.
2. `.agents/prototypes/action-escalation/README.md` and `evidence.json`: 11 isolated integration scenarios exercise real question/reply/panel implementations with fake child sessions, scripted parent/operator decisions and a simulated execution counter. Evidence SHA-256 `c783d48aa35882d8771228214ea67a8b2f5fbe2cd6612bf929bfad7f9b61cd2a`. The README hash stored inside evidence identifies its historical experiment version; the current acceptance README is later, not newly verified by that evidence. No SDK parent reception, inferred reasoning, real human consent or real action authorization is proven.

Gentle AI supplies instructional child-to-parent escalation; Gentle Shell demonstrates contextual classification for primary sessions but retains deterministic child guards. Neither establishes the complete replacement or justifies importing another framework. Existing capabilities are reuse evidence, not proof of completed enforcement.

## 11. Out of scope, risks and adoption limits

Out of scope of this technical definition: production code or canon amendments performed by the specification itself; publication, issue creation and ticket slicing are separate delivery operations, not authorization behavior; automatic production adoption; selecting numeric thresholds/model/cache/inference budget; mandatory extra prototype; new universal worktree requirements; role/tool/grant exclusivity; recursive-child product expansion; Jev authority classification; replacement of procedure owners; blanket commit/publication permissions; universal process sandboxing or rollback guarantees. Tool parity remains the approved intent, not an excuse to invent exclusions for hard-to-integrate tools. Existing transport limitations must be handled, not redefined as permanent product exclusions.

Accepted residual risk: the user explicitly accepted continuation of definition with real integration unverified. Resolver/source/status are in section 2 and the final functional review; this is not a production waiver. Incorrect permission, unnecessary escalation and repeated inference delay remain substantive risks. The user's concern that observed latency is high is preserved as a baseline measurement concern, not converted into a numeric target.

Additional technical limitations to retain during implementation: arbitrary reply text is not authority; Run state is not authorization; event coverage is not a sandbox; shell descendants and hooks can exceed observed effects; signing checks may establish only a signature header, not cryptographic signer identity; pre/post scope checks are not atomic. Treat uncertainty through consultation and require real coverage evidence before adoption. These observations do not reopen accepted user decisions or invent new mandatory infrastructure.

## 12. Shared-capability invariants and final handoff

Carry these into implementation and eventual slicing:

- Same tools available does not mean same action always permitted: equivalent authority/action receives equivalent authorization, while different assignments legitimately differ. Roles, seating and Jev are not permission grants.
- Necessary in-scope work is implicit; the contextual mechanism replaces conflicting inventories rather than layering over them.
- Explicit action-target confirmation remains required for destruction/high impact, including expanded scope; one clear response can satisfy both.
- Uncertainty and classifier/consultation infrastructure failure preserve a recoverable child-parent-user path with zero unauthorized dispatch. Unrelated authorized work may continue; unresolved actions may not.
- Correlated transport, current action-target authority and single dispatch are separate obligations. Existing identity checks and `running` are insufficient by themselves.
- Any child may make a task-authorized signed scoped commit; assigned authorized context is required, isolation is retained where interference is possible, and tool availability implies neither commit nor publication.
- Preserve applicable canon/procedures except the exact proposed supersessions; canonical reconciliation is separate implementation work.
- Both prototypes remain reference evidence. Missing generated authority artifacts remain explicit gaps. Real integration and measured, agreed adoption criteria are still required before production.

Final functional review reference: [stable functional review](../features/contextual-action-authorization-review.md), renewed capture for brief `be690abb…`, parent verdict **READY WITH WARNINGS**. Need/coherence and scope lenses reported no new findings; feasibility's sole new missing-sibling warning was **WITHDRAWN** under the exact rule “or all when fewer exist.” Only one child-bash and one checkpoint implementation exist; fleet broker is a shared caller. No finding remains undisposed. Real-integration uncertainty retains the user's definition-only acceptance.

Technical readiness remains **READY WITH WARNINGS**. The parent owns delivery preview, exact-match durable-artifact inspection, publication, parent-issue equivalence reinspection and verified read-back. The specification/review pair and separate joint feature artifacts remain distinct. `PUBLISHED` may be asserted only after all applicable read-backs for the current package and handoff; only then may the published package proceed to `to-tickets`. Publication alone does not authorize implementation or adoption. Prototype commit `54f4f01` is evidence provenance only, not specification identity or an implementation base.
