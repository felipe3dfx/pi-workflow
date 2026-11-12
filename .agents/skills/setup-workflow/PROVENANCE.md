# Skill Provenance

## Source

`skills/engineering/setup-matt-pocock-skills`, from <https://github.com/mattpocock/skills/tree/6acc160e4e0cd062dbbbd7a1b26ae92855edf07e/skills/engineering/setup-matt-pocock-skills>, distributed as the `mattpocock-skills` package version 1.2.3.

`skills/in-progress/pr`, from <https://github.com/mattpocock/skills/tree/c55ee46073ed923f86ce59a5eb3b6d895095d1b7/skills/in-progress/pr>, whose `CREDITS.md` credits the shape of its change sections, reproduced almost word for word, to Dex Horthy's `show-me` skill, at <https://github.com/humanlayer/skills/tree/bba9d13ab34f0a87f1cc33df4dd196372393ddfc/plugins/show-me/skills/show-me>.

Reviewed at `mattpocock/skills` release v1.3.2, commit `d1478fcb140db0b93c0c8df17bcfd311844749d0`: `skills/engineering/setup-matt-pocock-skills/SKILL.md`, its GitHub, GitLab, and local Markdown issue-tracker templates, and `skills/engineering/pr/SKILL.md`, at <https://github.com/mattpocock/skills/tree/d1478fcb140db0b93c0c8df17bcfd311844749d0/skills/engineering>.

## Author or owner

Matt Pocock, for `mattpocock/skills`. The change-section shape that `skills/in-progress/pr` reproduces is credited by its own `CREDITS.md` to Dex Horthy, for HumanLayer; the condensed section guidance in `assets/pull-requests.md` follows that shape, and no other part of either source skill is derived from it.

## License or terms

MIT

## Notice

Copyright (c) 2026 Matt Pocock

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

MIT License, Copyright (c) 2026 HumanLayer, for the `show-me` skill whose change-section shape the pull-request body guidance follows.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Retrieved

2026-08-24, from `mattpocock-skills` version 1.2.3 at commit `6acc160e4e0cd062dbbbd7a1b26ae92855edf07e`.

2026-09-21, from `skills/in-progress/pr` at commit `c55ee46073ed923f86ce59a5eb3b6d895095d1b7`.

2026-09-21, from `humanlayer/skills` `plugins/show-me/skills/show-me` at commit `bba9d13ab34f0a87f1cc33df4dd196372393ddfc`.

2026-10-01, the glossary rename, following upstream `mattpocock/skills` commit `e484a8095543718ced436b9b49a8160ed4554000`.

2026-11-01, review of `mattpocock-skills` release v1.3.2 at commit `d1478fcb140db0b93c0c8df17bcfd311844749d0`.

## Material used

The setup run sequence and the domain-document and issue-tracker playbook formats from `SKILL.md`, `domain.md`, and the GitHub, GitLab, and local Markdown issue-tracker templates. The three-section pull-request body template and its section guidance from `skills/in-progress/pr/SKILL.md`, whose section shape that record credits to Dex Horthy's `show-me` in `humanlayer/skills`. From the v1.3.2 review: the fork-destination check, the blocker semantics and open-blocker rule, and the post-then-close explanation order of the GitHub and GitLab templates, and the optional Merge Danger lines of `skills/engineering/pr/SKILL.md`.

## Modifications

Grupo Ilao converted the source setup into an agent-agnostic workflow-discovery skill, added Linear, removed triage labels and provider-specific execution requirements, and added idempotent drift handling, distributed capability states, branch proposals, quality, and pull-request playbooks. The pull-request body derives from `skills/in-progress/pr`, condensed to the fixed three-section contract `assets/pull-requests.md` ships and extended with per-section fill guidance. Following upstream `mattpocock/skills` commit `e484a8095543718ced436b9b49a8160ed4554000`, the domain playbook and validator use `GLOSSARY.md` and `GLOSSARY-MAP.md`; a root file under a retired name blocks and is reported as drift instead of being adopted. The GitHub playbook reads and publishes parent-child relationships, the Linear playbook records every closing automation off and the specification parent's precedence over a required `parent`, and the pull-request playbook and the mutation-scope scenario record that closing a ticket is an effect of its own under the approval policy and that no skill or tracker automation closes a specification's parent, without enumerating skills. The workflow playbook records the consumer's approval policy, and the pull-request playbook defines its levels, the floor every level asks for, and the approval preview. The tracker playbooks leave the issue title and body to the publishing skills instead of recording a consumer template. The quality playbook records how scratch runs isolate state shared across checkouts, with that capability's state, evidence, and degraded path; scratch has no provider, limits, or effects of its own to record. The quality playbook runs focused validation on the touched area plus the callers and consumers it affects, and states that CI runs full validation after publication and no review skill runs it. The quality playbook states that `create-pr` runs Full Validation before a push only when its publication gate, selected by the change's impact, reaches it, as ADR 0030 records; ADR 0031 makes that selection apply to every consumer and the full class generic, so the playbook records neither a publication gate nor the paths that select Full Validation, and an update refuses a playbook that still carries the retired `## Publication Gate` section until the user removes it. The quality playbook directs the consumer to declare which full suites each path reaches in the document Test Conventions names, outside the playbook, so `create-pr` runs only those suites for a full-class change, as ADR 0032 records. The glossary-map validator moved to `domain-modeling` as ADR 0034 records: discovery invokes it as the installed sibling `../domain-modeling/scripts/glossary_map.py`, the script refuses every command when that sibling is missing, and `references/installed-files.md` lists what a run leaves in the consumer and which skills read each file, so the skill can be uninstalled after a run and reinstalled to update.

The v1.3.2 review, recorded on 2026-11-01, adopted four transformations. The GitHub, GitLab, and Linear playbooks confirm, before any tracker change, that the destination the access mechanism will act on equals the recorded repository, project, or team, generalized from upstream's fork check without naming a client, requiring a remote, or initializing or configuring anything, and under the existing capability evidence rule. Fetching a ticket on those trackers retrieves its native blocking relationships with each blocker's state, keeps the parent apart from blockers, and lets only an open blocker block; GitLab does so only where the project offers native blocking links, and the local Markdown and none playbooks gain no native support. Where a skill closes an issue with an explanation, those playbooks post and read back the explanation before closing, then read back the closed state, each under the approval policy, and a recovered closure posts no explanation the issue already shows; no comment is imposed on every closure. The pull-request body's Merge Danger gains the optional concise lines under the door and blast-radius labels, which upstream's template already carried at commit `c55ee46073ed923f86ce59a5eb3b6d895095d1b7` and the earlier condensation omitted; the one-word labels stay, with no new heading or gate. The review rejected triage labels and label creation, pull and merge requests as a triage surface, the wayfinding operations, the copied CLI commands and flags, the `git init` and remote wiring, the automatic `CONTEXT.md` rename, and the body-line fallbacks for blockers and parents.

The tracker playbooks record that a comment policy may only reduce or schedule the publishable events and never adds another kind, and that progress and decision comments carry only a scope change, a deviation, an accepted risk, or the pull request link, with technical decisions staying in the commit body. They also record one comment shape no policy overrides: written for a person without the code, in Spanish and domain language, in at most five lines stating the fact, then why, then what changes for the reader; the Linear pull-request comment carries the URL plus one or two lines on what the reader will see change and leaves the evidence in the pull request. The local Markdown playbook has no closure explanation, so its shape paragraph omits the closure clause.

## Approval

Internal reuse under the MIT license was approved through the group specification in Grupo Ilao skills issue #13.
