# Delegation router: validated direction

Status: design validation only. This note records a conversation. It is not an ADR and it does not establish an operational requirement.

Implementation home: this repository (`pi-workflow`), not `grupo-ilao/skills`.

## Decision

Build one Pi extension in this harness with two modules:

- `decide` classifies a bounded task with TypeSafe Jev.
- `delegate` owns the subagent tool the orchestrator sees, calls `decide` when `model` is absent, then launches a Pi child session.

Do not install `pi-jev-model-router` as the product. Do not adopt `gentle-pi` as the delegation engine. Do not keep `@tintinweb/pi-subagents` installed once this extension registers the same tool names.

Laya is a later backend behind the same question contract. It is not in the first version.

## What the user wants

The orchestrator session stays on its current model and thinking level. Jev does not call `pi.setModel`. The user talks to one session. Delegation is what changes model.

The choice should feel natural: no per-spawn confirmation, and no tool the orchestrator must remember to call. The extension intercepts the spawn. If `model` is empty, it fills `model` and `thinking`. If the user named a model, that name wins unless a policy floor forbids it.

Jev is SaaS for the first version. The machine can run Laya later (Ryzen 9 3900XT, 32 GB RAM, RTX 2070 SUPER 8 GB, one resident checkpoint). System Python is 3.14, which is the wrong interpreter for Laya's Torch stack. That work waits.

## Why the referenced packages do not fit

### `pi-jev-model-router`

Referent: <https://pi.dev/packages/pi-jev-model-router> and <https://github.com/da-vinci-noob/pi-jev-model-router>.

Useful shape: four parallel typed questions, policy composed in code, fail-open, visible reason, candidate chains.

Does not fit:

- `auto` calls `pi.setModel` on the parent turn. That violates the fixed orchestrator.
- Default chains are OpenRouter aliases, not the Codex / Grok / NaN pairs below.
- It classifies the user prompt, not a subagent spawn.
- It has no role, risk floor, or "should this leave the session" question.

### `pi-jev-anti-slop`

Referent: <https://github.com/BubbatheVTOG/pi-jev-anti-slop>.

Useful shape: closed question packs, thresholds in TypeScript, a flag is a signal to look, not a verdict. Out of scope for this router. Do not treat `jev_review` `block` as a skill or delegation gate.

### `gentle-pi` versus installed `pi-subagents`

Installed today: `@tintinweb/pi-subagents` 0.19.0. Local referent: `/home/felipe3dfx/Documents/repos/gentle-pi` at package version 3.3.0.

`gentle-pi` is a full harness (persona, skills, SDD, phase model table in `.pi/gentle-ai/models.json`). Gentle Agents replaces `pi-subagents-j0k3r` and refuses to register while that package is installed. Its generic delegation prompt says not to pass `model` and to let the subagent package resolve it. That resolution is static config or frontmatter, not a per-task judgment.

`pi-subagents` is the spawn runtime already in use. It does not classify. Keeping it and hooking it from outside means two model policies. Replacing it with a thin owner of the tool avoids that, provided the child process is still a Pi session and the spawn engine is not rewritten.

Copy from gentle-pi only the idea that the model is resolved at launch, not invented in the prompt. Copy from `pi-subagents` the idea of markdown agent definitions and a fresh child context. Do not copy persona, SDD, phase tables, OpenRouter chains, or parent `setModel`.

## Modules

```text
subagent(task, role?, model?)
  if the user named a model and the floor allows it -> that model
  else decide(task) -> role + model + thinking
  if Jev does not answer -> fixed table
  launch a Pi child session with that model and thinking
  return the model that actually ran
```

`decide` does not launch, does not know worktrees, and does not pick a failover provider.

`delegate` owns the orchestrator-facing tool, agent markdown definitions, floors, and the result envelope. It calls Pi to open the child. It does not reimplement isolation, cancellation, or worktrees.

A consult tool may exist for "where would you send this?". It is not the normal path.

## Jev questions

One request, parallel questions. Code composes the result. Confidence does not authorize an action by itself.

Task judgment, adapted from the referent router:

- `task_kind`: `plan`, `implement`, `debug`, `refactor`, `review`, `research`, `explain`, `operate`, `write`, `chat`.
- `complexity`: trivial to architectural.
- `capability_deserved`: price ignored.
- `needs_deep_reasoning`: noul.

Delegation judgment added for this harness:

- `should_delegate`: the task is bounded and verifiable enough to leave the session. Stay if it is architecture, an unresolved user decision, or a conflict between agents.
- `role`: `explore`, `worker`, or `verify`.
- `risk`: `none`, `judgment`, or `high-stakes`. High-stakes means security, concurrency, migration, data integrity, or a public contract.
- `context_volume`: whether the task needs a long-context specialist. The code may then prefer `nan/mimo-v2.5`. Jev does not name that model.

Do not ask Jev which provider to retry after quota, whether a workflow is authorized, whether a result is correct, or which of two agents is right.

Low confidence or an unknown label means abstain. Abstain uses the fixed table. It does not block the spawn.

## Model table

Source: `pi --list-models` on this machine at validation time. Chains are only these models. `useDefaultModels` from the referent package does not apply because that package is not the product.

Excluded: `flux-2-klein`, `kokoro`, `whisper`, `qwen3-embedding`, `rerank`, `minimax-h3`, `grok-4.5`, `grok-4.6`. Also excluded from the fixed pairs unless the user later adds them: `gpt-5.5`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.3-codex-spark`.

| Tier | Use | Chain |
|---|---|---|
| `quick` | mechanical, transcription, cheap sweep | `nan/qwen3.8-flash` thinking `low`, then `nan/gemma4` `low`, then `nan/glm5.3-flash` `low` |
| `standard` | Worker: exploration, implementation, tests | `openai-codex/gpt-5.6-luna` `high`, then `xai/grok-4.7` `low`, then `nan/glm5.3-flash` `low` |
| `high` | Judge: coordination, review, risk | `openai-codex/gpt-6-astra` `low`, then `xai/grok-4.7` `medium`, then `nan/deepseek-v4-flash` `medium` |
| `premium` | unused | empty |

Kind floors: `plan` and `review` do not go below `high`. `implement`, `debug`, and `refactor` do not go below `standard`. `chat` and `explain` may be `quick`. `research` follows risk: high-stakes stays Judge.

`mimo-v2.5` is a context specialist, not a tier.

NaN is not the quota failover for Codex or Grok. That order stays in orchestrator policy. Jev does not see it.

Thinking is pinned on the chain entry. A substituted model or a clamped thinking level leaves the delegated work pending. The recommendation does not authorize a silent substitute.

## Floors the code owns

- The parent session model and thinking do not change.
- An explicit user-named model wins, unless the floor below rejects it.
- `risk: high-stakes` or `risk: judgment` does not leave as a Worker below Judge.
- Missing Jev key, timeout, or unknown label: warn and use the table. The turn is not blocked.
- The result records the model that ran and why. That record is for the user and the session, not a second prompt to the parent model.

## Skills repository

The engineering skills stay agent-agnostic. This router is harness configuration. Do not add Torch, a Jev client, or model names to `grupo-ilao/skills`.

An earlier branch of the same conversation considered Laya or Jev as a hint inside skill decision gates (`scope-audit`, `code-review`). That is a different product. It is not part of this delegation router. If it returns, the rule was: closed enums, fail-open, never a verdict.

## Explicitly not in the first version

- Laya sidecar.
- Parent-session auto switch.
- Budget and prompt-cache switching from `pi-jev-model-router`. Those matter only if the parent model changes.
- A rewritten subagent runtime.
- `gentle-pi` install.
- Skill-gate packs.

## Open when implementation starts

- Exact tool name, and removal of `@tintinweb/pi-subagents` so names do not collide.
- Which Pi API launches the child session without reimplementing `pi-subagents`.
- Where agent markdown definitions live in this repo.
- The JSON shape returned to the orchestrator.
- Where the TypeSafe key is read (`TYPESAFE_API_KEY`), never committed.
