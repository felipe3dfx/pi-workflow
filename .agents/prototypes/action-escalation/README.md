# Action escalation integration prototype

## Decision boundary

Recommended disposition: **reference-only**. User-confirmed disposition: **reference-only**, explicitly accepted by the user in the current conversation. This acceptance covers the evidence and brief delta, not a production implementation contract.

Question: can existing child questions, parent replies and the operator question carry the proposed escalation sequence without changing production seams? Success means every scripted scenario observes the required Run states, causal order and fixture authorization guards, with exactly one simulated execution on authorized paths and zero on refusal/cancellation paths.

Scope: transport and panel integration, not authorization accuracy. The draft [brief](../../../docs/features/contextual-action-authorization.md) records the user-accepted evidence and limitations. Current production does not automatically classify actions, escalate authorization decisions or enforce the approval semantics exercised here. Text transport validates child identity and question number, not action authority. This experiment adds no runtime classifier, Jev behavior, MCP invocation or actual classified action.

## Reproduce and inspect

From the repository root:

```sh
node --test .agents/prototypes/action-escalation/integration.test.mjs
node --test test/child-sessions.test.mjs test/ask-user-panel.test.mjs
npm run check
```

The first command writes `evidence.json` only after all 11 scenarios produce observations and pass assertions. It records ordered events, Run states, counters, rejection messages and input-source hashes, without generated timestamps or random child identifiers. It needs no extra runner, credentials, inference or network. Hidden prototype tests are not discovered by the repository gate, so run the explicit command too. The two repository validation commands exercise broader local fixtures; their console output, not this evidence file, establishes their results.

## Fidelity and doubles

| Boundary | Real implementation exercised | Double / limitation |
| --- | --- | --- |
| Child/model factory | `createChildSessions` with repository `fakeChildren` support | Fake session factory; scripted child calls real `createAskParentTool(spec.ask)`. No model or real child SDK session. |
| Parent | Emitted `pi-workflow-child-question` delivered to injected `send`; `createChildQueryTools` real `reply_child` calls `sessions.reply` | Scripted parent driver reacts to that message; no inferred parent reasoning, SDK turn scheduling or real parent wakeup proven. Delivery-failure case deliberately throws at this boundary. |
| Human/terminal | `createAskUserQuestionTool` through real `askPanel`; injected `ctx.ui.custom` instantiates the actual component, renders it and calls `handleInput` | Simulated operator types fixture answers or dismisses; real panel abort is signalled. No real human consent or terminal fidelity claimed. No-UI case separately uses print mode and asserts zero panel openings. |
| Executor | Scripted exact reply-text and current Run state guard | Counter only; no actual verification, deletion, publication or classified action. This guard is prototype code, not production enforcement. |

Semantic inputs are newly declared synthetic fixtures in the test. No frozen classification outcome is imported or presented as model evidence. All semantic judgments, parent decisions and approval interpretations are simulated.

## Scenarios and proposed falsifiable contract

- `parent-facts`: parent resolves ownership for proposed in-scope verification; zero operator consultations.
- `unresolved-parent`: parent cannot resolve ownership; one real operator-question tool call with simulated text input, then real reply and one simulated execution.
- `destructive-out-of-scope`: one consultation names both scope expansion and destructive discard of `fixture://other-owner/draft`; one explicit action-target response satisfies both scripted conditions.
- `dismissal`, `panel-abort`, `user-unavailable`: actual operator-question refusal is relayed as nonauthorization through real reply; child resumes without simulated execution. Unavailable UI opens no panel.
- `cancelled-waiting`: real cancellation rejects the pending ask; later reply is rejected; zero execution.
- `delivery-failure`: injected question delivery throws; real ask rejects and Run state returns to running; zero execution rather than permission by default.
- `foreground-refusal`: foreground child cannot ask its blocked parent; zero delivered questions and executions. Questions require background children.
- `reply-identity-guards`: wrong child ID and number leave the first question waiting; after its nonauthorizing reply, a duplicate first reply cannot release the second pending question. Only the actual second reply releases the final simulated execution.
- `wrong-target-nonauthorization`: answered panel with explicit approval for a different target does not authorize the proposed target in the scripted guard.

For successful background paths the asserted causal sequence is real ask → waiting → emitted message → scripted parent decision / real operator-question tool with simulated input → real reply → running/resumed child → simulated execute. Counters are asserted zero at each ask, question delivery, parent reception and reply boundary; authorized fixtures execute exactly once. Refusals can resume a running child: Run state is not authorization. Assertions and generated observations, rather than this scenario inventory, determine each run's success.

## Interpretation and accepted brief delta

Confirmed mechanically if checks pass: existing seams can carry the scripted sequence unchanged; child ID/question-number validation prevents stale replies from releasing another pending question. Panel dismissal, abort, absent UI, cancellation and delivery errors provide observable nonanswer paths.

Contradicted: treating transport success, a running child or arbitrary parent text as sufficient authorization. The existing text protocol has no structured action-target binding, authorization token or executor gate. Cooperative cancellation is not a security boundary (ADRs 0013–0018); this counter fixture cannot establish safety for tools that ignore abort.

User-accepted brief delta, applied to the draft: existing question/reply mechanisms support escalation in an isolated integration with simulated decisions. Real parent reception through the SDK, reasoning, human interaction and authorization of real actions remain unverified. The classification evidence remains separate. Production adoption, acceptable latency, policy/ADR reconciliation and authority enforcement remain open. No UI contract or production change is approved by this artifact.
