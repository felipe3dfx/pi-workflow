# @felipe.3dfx/pi-workflow

A Pi harness package for companion readiness. Version 0.2.0 removes the 0.1.x product workflow. Product workflow no longer lives here.

Grupo Ilao engineering skills own process semantics: discovery, specification, tickets, implementation, review, QA impact, and publication. This package only reports and installs the companion packages those skills ask a Pi harness to provide. It does not publish Linear issues, store workflow artifacts, or reconcile uncertain external effects.

## Commands

```text
/pi-workflow-status
/pi-workflow-doctor
/pi-workflow-install-companions
/pi-workflow-install-companions --apply
/pi-workflow-models
/pi-workflow-models-edit
```

Status and doctor are read-only. Install without `--apply` prints the plan and does not mutate Pi. `--apply` is the confirmation for that invocation: it installs missing companions and aligns the MCP catalog. A failed install stops. It does not retry an uncertain effect.

`/pi-workflow-models` creates the global model lists file (`pi-workflow-models.json` in the Pi agent directory) with specialist lists, the `quick`, `standard`, and `high` tier lists, and the task-type map. It replaces an existing file only after TUI confirmation; print mode only warns. A model that research or Jev cannot place is left out. `/pi-workflow-models-edit` edits the same file in a TUI panel: specialist lists, tier lists, and the task-type map, with models picked from the Pi model catalog. It refuses an invalid or unreadable file. A written file applies after `/reload`. The command reads each model's Pi catalog metadata, asks Jev (TypeSafe) to pick its thinking level among the levels the model supports, then asks Jev for its task type. It never invents a thinking level: a model whose research or classification fails is left out with a reason and the others are saved. Jev needs a TypeSafe API key: run `/login` and choose "TypeSafe (Jev)" (API key; Pi stores it in `auth.json` under `typesafe`, and `/logout` removes it), or set `TYPESAFE_API_KEY`. Without a key every model is left out and no request is sent.

## Install

```bash
pi install npm:@felipe.3dfx/pi-workflow
```

Reload Pi, then inspect companions:

```text
/reload
/pi-workflow-status
```

Install engineering skills from the Grupo Ilao catalog into the consumer repository. This package does not bundle them.

0.1.x commands `/define-product`, `/deliver-ticket`, `/qa-handoff`, and `/product-review` are gone. Use the engineering skills instead. `pi-workflow-sync` is gone with the packaged agent assets.

## Disposable Pi test launcher

```bash
npm run pi:sandbox
```

The launcher isolates Pi home, configuration, packages, and sessions. It is not a filesystem security sandbox.

## Requirements

- Node.js `>=22.19`
- Pi CLI available in the target environment
