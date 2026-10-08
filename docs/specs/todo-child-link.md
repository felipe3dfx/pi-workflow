# Todo and child session link

Status: SPECIFIED (#207).

Package: the decisions confirmed in the #207 grilling session (2026-10-08).
Review handoff: none. This specification was synthesized from the grilling session without a `feature-review` report.
Dependency: the Fleet view (#217–#220), already shipped.

## Problem

The parent keeps a Todo and launches child sessions to execute its tasks, but the two capabilities do not know about each other. The parent must update each task by hand after reading each child's result, and the Todo only knows whether a task is done. It cannot say that a task is being worked on or that it needs the parent's attention. The operator cannot see which child executes which task.

## Solution

When the parent launches a child, it may name the Todo task the child executes. The harness moves that task through its Task state: in progress while the child works, then done, blocked, or pending once the parent consumes the child's result. The parent can always change the Task state afterwards. The Todo box shows which child executes a task, and the Fleet view shows which task a child executes.

## User stories

1. As the parent, I want to name a Todo task when I launch a child, so that the task follows the child's work without manual updates.
2. As the parent, I want a launch naming a missing task to be refused, so that work never runs without the trace I asked for.
3. As the parent, I want a launch naming a done task to be refused, so that I reopen it deliberately before executing it again.
4. As the parent, I want a launch naming a task to be refused while the Todo is not seated, so that the link never points at a capability I cannot see.
5. As the parent, I want the task to become in progress as soon as the launch is accepted, even if the child is queued, so that I do not launch it twice.
6. As the parent, I want a Launch blocked or a Launch limit refusal to leave the task untouched, so that a launch that never happened changes nothing.
7. As the parent, I want a waiting child's task to stay in progress, so that a question does not look like progress or failure.
8. As the parent, I want the final Task state applied only when I consume the child's result, so that the Todo never runs ahead of what I know.
9. As the parent, I want a worker's `done` or a verifier's `pass` to mark the task done, so that finished work is reflected.
10. As the parent, I want a completed explorer to mark its task done, so that an exploration task closes when the exploration ends.
11. As the parent, I want `blocked`, `fail`, and `partial` to mark the task blocked, so that I see which tasks need my attention.
12. As the parent, I want a failed or timed-out child to mark its task blocked, so that unfinished work asks for my attention.
13. As the parent, I want a cancelled child to return its task to pending, so that an abandoned attempt does not look like a problem.
14. As the parent, I want the consumed result to tell me which Task state was applied, so that I never overwrite it blindly.
15. As the parent, I want to change a linked task's Task state at any time, so that I can disagree with a Specialist's Verdict.
16. As the parent, I want a later consumed result to set the Task state even after I changed it, so that the latest event wins.
17. As the parent, I want `continue_child` to keep the original child's task and move it back to in progress, so that a follow-up on the same conversation stays on the same task.
18. As the parent, I want a task to be executed by several children over time, such as a worker then a verifier, so that the normal delivery flow fits the Todo.
19. As the parent, I want only the latest child's consumed result to decide the task's Task state, so that an earlier attempt does not override a later one.
20. As the parent, I want each child launched from one `codemode` Group to name its own task, so that a fan-out maps to several tasks.
21. As the parent, I want a child to execute at most one task, so that one Verdict never stands for several tasks.
22. As the parent, I want rewriting or clearing the Todo while a child works to drop the link, so that I stay the owner of my list.
23. As the parent, I want the consumed result to tell me when its task no longer exists, so that I know no Task state was applied.
24. As the parent, I want the Task state still applied when the Todo becomes unseated while the child works, so that accepted work finishes as Seating promises.
25. As the parent, I want to set any Task state on any task with the `todo` tool, so that tasks without a child can also be in progress or blocked.
26. As the parent, I want the Todo, including the harness's Task state changes, restored when the session reloads or I move in the session tree, so that the list survives like the rest of the session.
27. As the operator, I want each Todo task to show its Task state with a distinct glyph, so that I read the plan at a glance.
28. As the operator, I want an in-progress linked task to show the child's role and short id, so that I know which child to follow in the Fleet view.
29. As the operator, I want a child's Fleet view row to show the task number and text, so that I know what each child is doing for the plan.
30. As the operator, I want the Fleet view to keep showing Run state and Verdict, not Task state, so that the row stays free of repetition.

## Implementation decisions

Every decision below was resolved by the developer in the #207 grilling session. All are mandatory unless labeled a recommendation.

### Task state

- The Todo task's boolean done flag is replaced by a Task state: `pending`, `in progress`, `done`, or `blocked`. Source: GLOSSARY.md, Task state. No compatibility path keeps the boolean.
- `blocked` means the task needs the parent's attention, not that something external holds it.
- The `todo` tool reads and sets the Task state in place of the done flag for `write`, `add`, `update`, and `list`. Its text summary shows each task's Task state.
- The rule that an all-done list restores as empty applies to an all-`done` list.

### The link

- `spawn_child` gains an optional `todo` parameter: the id of the task the child executes.
- The launch is refused, before Jev is asked or a child session is created, when the task does not exist, when its Task state is `done`, or when the Todo is not seated. Each refusal names its reason.
- A child carries at most one task. A task may be linked to several children over time; the latest linked child is the one whose consumed result sets the final Task state. A result from an earlier child of the same task applies no Task state.
- `continue_child` keeps the continued child's task and sets it to `in progress` when the follow-up launch is accepted.
- In a Group, each `spawn_child` call carries its own `todo`.

### Transitions

- Launch accepted, queued included: the task becomes `in progress`. A Launch blocked or a Launch limit refusal changes nothing. `waiting` changes nothing.
- On consumption of the result, by any consumption path (reading it, automatic delivery, continuing the child, or cancelling it with `cancel_child`):
  - Verdict `done` or `pass`, or a completed explorer: `done`.
  - Verdict `blocked`, `fail`, or `partial`: `blocked`.
  - Run state `failed` or `timed out`: `blocked`, even if a timed-out child reported a last result.
  - Run state `cancelled`: `pending`.
- The consumed result states the Task state it applied, or that its task no longer exists.
- The parent may change any Task state at any time; the latest change wins, whether from the parent or from a consumed result.
- When the linked task id no longer exists at consumption, because the parent rewrote or cleared the Todo, nothing is applied.
- Seating: the Todo becoming unseated after launch does not stop the Task state change; only its screen place is withdrawn.

### Persistence

- Task state changes made by the harness must be restored on `session_start` and `session_tree` exactly like changes made with the `todo` tool. Today the Todo is rebuilt only from `todo` tool results, so the harness's changes need a session entry the replay reads. Recommendation: one append-only session entry per harness change, carrying the full task list like a `todo` tool result, so that replay keeps a single rule (the latest list wins). Sessions only append; nothing already sent to the model is rewritten.
- Known limitation: after a reload, task ids continue from the current branch's highest id, so on a later `session_tree` move to a branch created in a different process whose ids overlap, a child still linked to task #N may apply its Task state to a different task with the same id on that branch.

### Presentation

- Todo box: one distinct glyph per Task state, keeping the current `done` check and `pending` box. An `in progress` task whose latest linked child is still a Working child appends the child's role and short id (`← worker a1b2`). The hide-done toggle hides only `done` tasks.
- Fleet view: a linked child's row shows `#<id>` and the task text, truncated to the row. It does not show the Task state.

### Shared-capability invariants

- Todo and child session stay separate harness capabilities. The link never makes one require the other to be seated, except the launch refusal when the Todo is unseated.
- The Tool gate, Jev routing, and the Launch limit are unchanged.
- Results are consumed once. Applying a Task state never delivers a result again (ADR 0010).

## Testing decisions

- Tests observe external behavior only: tool results, the `todo list` summary, the consumed result text, and rendered lines. They do not inspect internal maps or entries.
- Primary seam: the full extension loaded with a fake `pi` and a stubbed child creator, as `loadExtension` does in the child session tests. It covers the launch refusals, the in-progress transition, every final transition by Verdict and Run state, every consumption path, the overwrite rules, the latest-child rule, `continue_child`, a Group, the dropped link, unseating mid-run, and restore on `session_start` and `session_tree`.
- Rendering seams, already tested: the Todo box renderer (glyph per Task state, the child annotation, hide-done) and the Fleet view row (task number and text, truncation, terminal-safe text).
- Prior art: the child session tests, the delegation gate tests for seating, the Todo extension tests for replay, and the Todo header tests for the box.
- Existing Todo tests that assert the done flag are rewritten to Task state.

## Out of scope

- One child executing several tasks.
- Blocking the parent from changing a linked task's Task state, or from rewriting or clearing the Todo while children work.
- Showing Task state in the Fleet view.
- Marking a task from a child's completion before the parent consumes its result.
- Task dependencies, task ordering, or Jev choosing a task.
- Any change to Verdict values, Run states, or the Launch limit.

## Further notes

- No ADR was recorded: applying the Task state on consumption is easy to reverse and is what #207 proposed.
- The open questions of #207 are answered: a cancelled child returns its task to pending, a failed or timed-out child marks it blocked, and a child executes at most one task.
