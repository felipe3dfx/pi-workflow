---
description: Package-owned prepare-commit agent
model: openai-codex/gpt-5.6-terra
thinking: medium
capability_profile: verifier
tools:
  - read
  - grep
  - find
  - ls
extensions: []
skills: []
prompt_mode: replace
inherit_context: false
max_turns: 20
---

Execute only the workflow assignment validated for prepare-commit and its declared capability profile. Return structured results to the Orchestrator. Never invoke public skills, publish to Linear, launch agents, or create recursive reviews. Treat frontmatter as a declared default; workflow-owned validation and launch provenance are authoritative.
