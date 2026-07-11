# Linear workflow model research

## Scope

This note separates:

1. Native Linear semantics from official Linear docs
2. Current workspace configuration observed read-only via the authenticated workspace
3. Recommended `pi-workflow` mappings

If something could not be verified from docs or read-only workspace inspection, it is flagged explicitly.

## Primary sources

Official Linear docs:

- [Issue status](https://linear.app/docs/configuring-workflows)
- [Team pages / Active and Backlog views](https://linear.app/docs/default-team-pages)
- [Cycles](https://linear.app/docs/use-cycles)
- [Issue relations](https://linear.app/docs/issue-relations)
- [Parent and sub-issues](https://linear.app/docs/parent-and-sub-issues)
- [Issue labels](https://linear.app/docs/labels)
- [Teams](https://linear.app/docs/teams)
- [Sub-teams](https://linear.app/docs/sub-teams)
- [Delete and archive issues](https://linear.app/docs/delete-archive-issues)

Read-only workspace inspection was performed through the authenticated Linear workspace API exposed in this environment.

---

## A. Native Linear semantics

### 1) What Backlog, Todo, Started, Completed, and Canceled mean

Linear workflows are team-specific, but the default category order is fixed: `Backlog > Todo > In Progress > Done > Canceled`. Teams may rename and reorder statuses **within** a category, but not reorder the categories themselves. [Issue status](https://linear.app/docs/configuring-workflows)

Important distinction: Linear models **status categories**, not just status names.

- **Backlog**: default status group for newly created unstarted issues; the first backlog status is default unless a different Backlog or Todo status is explicitly made default. [Issue status](https://linear.app/docs/configuring-workflows), [Team pages](https://linear.app/docs/default-team-pages)
- **Unstarted**: active but not yet started work; default example is `Todo` / `To do`. [Issue status](https://linear.app/docs/configuring-workflows), [Team pages](https://linear.app/docs/default-team-pages)
- **Started**: work in progress or downstream active steps such as review/QA/custom started states. [Issue status](https://linear.app/docs/configuring-workflows), [Team pages](https://linear.app/docs/default-team-pages)
- **Completed**: closed-as-done outcomes such as `Done` or custom completed states like `Production`. [Issue status](https://linear.app/docs/configuring-workflows)
- **Canceled**: closed-without-completion outcomes such as `Canceled`, `Won’t Fix`, etc. [Issue status](https://linear.app/docs/configuring-workflows)
- **Duplicate**: reserved system-managed closed status automatically applied when an issue is marked duplicate. [Issue status](https://linear.app/docs/configuring-workflows), [Issue relations](https://linear.app/docs/issue-relations)
- **Triage**: optional inbox-like category before the workflow proper. [Issue status](https://linear.app/docs/configuring-workflows), [Teams](https://linear.app/docs/teams)

Linear’s own “Active” view is **not** “in cycle”; it means issues in the **Unstarted or Started** categories. Backlog, Completed, and Canceled are not active. [Team pages](https://linear.app/docs/default-team-pages)

### 2) Cycles vs Backlog vs workflow status

Cycles are team-specific, time-boxed planning buckets similar to sprints, but “not tied to releases.” [Cycles](https://linear.app/docs/use-cycles), [Teams](https://linear.app/docs/teams)

Status and cycle are **independent fields**, but Linear has a few documented automations between them:

- If a **Backlog** issue is moved to a cycle, Linear updates it to active `To do` status. [Team pages](https://linear.app/docs/default-team-pages)
- Teams can enable the reverse automation so that if issues are moved **out** of a cycle, they move back to **Backlog**. [Team pages](https://linear.app/docs/default-team-pages)
- Linear can auto-add active issues without a cycle to the current cycle; “active” here means statuses in the **Unstarted** and **Started** categories. [Cycles](https://linear.app/docs/use-cycles)

So: cycle membership does **not** define status, but Linear can synchronize them in specific documented cases.

### 3) Assignee vs Cycle

These are separate concerns:

- **Assignee** = who owns the issue now
- **Cycle** = which time-box/sprint the issue is planned into

Linear docs do **not** define Todo as “assigned to someone” or “assigned to a cycle.” Those are team conventions if used that way.

What Linear itself automates around cycles:

- automatic creation of upcoming cycles on the team schedule [Cycles](https://linear.app/docs/use-cycles)
- rollover of open issues into the next cycle, except issues moved to backlog, triage, canceled, or completed during cooldown [Cycles](https://linear.app/docs/use-cycles)
- optional auto-add of active issues to the current cycle [Cycles](https://linear.app/docs/use-cycles)
- optional move of active/no-cycle issues back to Backlog when enabling that automation [Cycles](https://linear.app/docs/use-cycles)
- optional move from Backlog to active `To do` when backlog issues are moved into a cycle [Team pages](https://linear.app/docs/default-team-pages)

I could not verify any native automation where changing assignee automatically changes cycle, or vice versa.

### 4) Blockers / dependencies

Issue-level dependencies are modeled through **issue relations**:

- `Blocked by`
- `Blocks`
- `Related`
- `Duplicate`

[Issue relations](https://linear.app/docs/issue-relations)

Documented behavior:

- blocked issues show under `Blocked by`
- blocking issues show under `Blocks`
- once the blocking issue is resolved, the relationship moves under `Related`
- duplicates move the issue into reserved `Duplicate` status

[Issue relations](https://linear.app/docs/issue-relations)

I found **no** official doc evidence that blocked/blocking relations automatically change workflow status.

### 5) Parent issues and subissues

Parent/subissue behavior is explicit:

- subissues inherit the parent’s **team, priority, and project** [Parent and sub-issues](https://linear.app/docs/parent-and-sub-issues)
- subissues **may** inherit the parent’s cycle when created in an active status [Parent and sub-issues](https://linear.app/docs/parent-and-sub-issues)
- labels are **not** inherited [Parent and sub-issues](https://linear.app/docs/parent-and-sub-issues)
- assignee inheritance is conditional, not absolute [Parent and sub-issues](https://linear.app/docs/parent-and-sub-issues)

Completion behavior is **optional team automation**, not guaranteed native always-on behavior:

- **Parent auto-close**: when all subissues are done, parent is marked done automatically
- **Sub-issue auto-close**: when parent is marked done, remaining subissues are marked done automatically

[Parent and sub-issues](https://linear.app/docs/parent-and-sub-issues)

So the answer is:

- completing every subissue only completes the parent **if that team enabled Parent auto-close**
- completing the parent only completes remaining subissues **if that team enabled Sub-issue auto-close**

### 6) Labels vs statuses vs cycles

Labels are for categorization, not workflow state. Linear docs describe labels as a way to “categorize issues.” [Issue labels](https://linear.app/docs/labels)

Useful native rules:

- labels can be workspace-level or team-level [Issue labels](https://linear.app/docs/labels)
- label groups allow one level of nesting [Issue labels](https://linear.app/docs/labels)
- only **one label from a given label group** can be applied to an issue [Issue labels](https://linear.app/docs/labels)
- reserved label names include `cycle`, `priority`, `project`, `state`, `status`, etc., specifically to avoid duplicating native features [Issue labels](https://linear.app/docs/labels)

That last point matters: Linear itself is signaling that workflow state, cycle, priority, project, and assignee should be modeled with native fields, not labels.

### 7) Built-in automations/configuration options

Documented built-ins relevant here:

#### Status / workflow
- custom statuses per team [Issue status](https://linear.app/docs/configuring-workflows)
- default status selection [Issue status](https://linear.app/docs/configuring-workflows)
- optional Triage category [Issue status](https://linear.app/docs/configuring-workflows)
- auto-close for stale issues [Issue status](https://linear.app/docs/configuring-workflows), [Delete and archive issues](https://linear.app/docs/delete-archive-issues)
- auto-archive for closed issues, and archive timing also affects cycles/projects [Issue status](https://linear.app/docs/configuring-workflows)

#### Cycles
- recurring cycle schedule [Cycles](https://linear.app/docs/use-cycles)
- cooldown periods [Cycles](https://linear.app/docs/use-cycles)
- issue rollover [Cycles](https://linear.app/docs/use-cycles)
- auto-add active issues to current cycle [Cycles](https://linear.app/docs/use-cycles)
- optional move active/no-cycle issues to backlog when enabling cycle automation [Cycles](https://linear.app/docs/use-cycles)
- backlog issue moved into cycle becomes active `To do` [Team pages](https://linear.app/docs/default-team-pages)
- optional reverse automation when removing from cycle back to backlog [Team pages](https://linear.app/docs/default-team-pages)

#### Parent/subissue
- optional parent auto-close [Parent and sub-issues](https://linear.app/docs/parent-and-sub-issues)
- optional subissue auto-close [Parent and sub-issues](https://linear.app/docs/parent-and-sub-issues)

#### Archival constraints
- active-cycle issues will not auto-close [Delete and archive issues](https://linear.app/docs/delete-archive-issues)
- closed issues in active cycles or unfinished projects archive only after those are also completed for the archive period [Delete and archive issues](https://linear.app/docs/delete-archive-issues)

---

## B. Current workspace configuration observed read-only

Inspection date: 2026-07-09.

### 1) Teams observed

- `Ilaos/Synergias`
- `Ilaos/Vertech`
- `Ilaos/Xuma`
- `Grupo ilao`
- `Diseño`
- `Migraciones`

### 2) Status model differences by team

Common pattern across most teams:

- `Backlog`
- `To do` or `Todo` in **Unstarted**
- `In Progress` in **Started**
- multiple custom **Started** states such as `In Code Review`, `Ready for QA`, `Ready for PO`, `Ready for PS`, `Review for QA`, `Stop`
- `Done` in **Completed**
- often `Production` as another **Completed** state
- `Canceled` in **Canceled**
- `Duplicate` reserved status

Notable differences observed:

- `Migraciones` has the simplest workflow: `Backlog`, `Todo`, `In Progress`, `Done`, `Canceled`, `Duplicate`
- `Diseño` uses design-specific started states `UX` and `UI`
- `Diseño` does **not** currently expose `Triage` in the observed statuses
- `Migraciones` does **not** currently expose `Triage` in the observed statuses
- The other four teams do expose `Triage`
- Several teams use both `Done` and `Production` as separate **Completed** statuses, so “done” vs “released/deployed” is being distinguished inside the completed category

### 3) Cycle differences by team

Observed current cycles:

- `Ilaos/Synergias`: current `Sprint 74`, next `Sprint 75`
- `Ilaos/Vertech`: current `Sprint 45`, next `Sprint 46`
- `Ilaos/Xuma`: current cycle number `32`, next `33`
- `Grupo ilao`: current `Sprint 45`, next `Sprint 46`
- `Diseño`: current cycle number `41`, next `42`
- `Migraciones`: no current or next cycle returned at inspection time

What can be said safely:

- cycles are clearly active for five teams
- `Migraciones` had no current/next cycle visible through the read-only API at inspection time

What could **not** be verified:

- whether `Migraciones` has cycles disabled entirely, is between configurations, or simply has no active/upcoming cycle right now
- whether any team enabled cycle auto-add or move-out-of-cycle-to-backlog automations, because those settings were not exposed through the read-only API used here

### 4) Label differences by team

Common workspace-level/shared labels observed repeatedly:

- `Bug`
- `Soporte`

Common team conventions using label groups:

- `Assign To` label groups containing people names
- `Estimacion QA`
- `Rechazos QA`
- `Esfuerzo Adicional`

This is important: the workspace is using labels for concerns that native Linear already has fields for, especially **assignee-like routing** (`Assign To`) and some quasi-workflow reporting concerns.

Team-specific examples:

- `Ilaos/Xuma` has domain labels like `Jerarquía`, `Migración`, and `Proyecto`
- `Grupo ilao` has `Agencia Solicitante`, `PS Asignado`, and person labels under `Assign To`
- `Diseño` has `Equipo` labels that mirror team names
- `Migraciones` has customer/account labels like `WMB`, `GIR`, `CentroSeguros`, `Seller`

### 5) What the workspace inspection does **not** prove

Read-only inspection of teams/statuses/cycles/labels does **not** reveal:

- whether parent auto-close is enabled on any team
- whether subissue auto-close is enabled on any team
- whether cycle auto-add is enabled on any team
- whether removing issues from cycles auto-moves them to backlog on any team
- which backlog or todo status is configured as default on each team

Those are configurable team settings, but they were not exposed by the read-only API surface available here.

---

## C. Explicit correction of the current mistaken assumption

Owner assumption:

> unassigned/unplanned work stays in Backlog, and moving to Todo indicates assignment to a Cycle

### What is native Linear behavior

Native Linear supports only part of that statement:

- **True natively**: new unstarted work goes to **Backlog** by default unless the team changed the default status. [Issue status](https://linear.app/docs/configuring-workflows), [Team pages](https://linear.app/docs/default-team-pages)
- **True natively in one specific automation path**: if a backlog issue is moved into a cycle, Linear updates it to active `To do`. [Team pages](https://linear.app/docs/default-team-pages)

### What is **not** native Linear behavior

These are **not** native invariants:

- `Todo` does **not** inherently mean “in a cycle”
- `Todo` does **not** inherently mean “assigned”
- unassigned work does **not** have to stay in Backlog
- planned work does **not** have to be represented only by moving to `Todo`

Why: Linear defines `Active` as **Unstarted + Started**, not “in a cycle,” and cycle is a separate field. [Team pages](https://linear.app/docs/default-team-pages), [Cycles](https://linear.app/docs/use-cycles)

### Best reading of the current workspace

Based on the read-only workspace inspection, the Owner statement looks like a **team convention layered on top of Linear**, not a native platform rule.

That convention may be useful, but `pi-workflow` should model it as:

- **workspace/team policy** if adopted
- **not** as universal Linear semantics

---

## D. Recommended `pi-workflow` mappings

### 1) Model native Linear fields directly

`pi-workflow` should keep these as separate first-class fields:

- `statusCategory` (`backlog | triage | unstarted | started | completed | canceled | duplicate`)
- `statusName` (team-specific display value like `To do`, `Ready for QA`, `Production`)
- `cycle` (nullable)
- `assignee` (nullable)
- `parentIssue` / `subissues`
- `relations.blocks` / `relations.blockedBy` / `relations.related` / `relations.duplicateOf`
- `labels[]`

Do **not** collapse cycle, assignment, and status into one “workflow stage” field. Linear does not work that way.

### 2) Recommended semantic mapping for planning/execution

Recommended `pi-workflow` interpretation:

- **Backlog** = not yet committed to active execution
- **Unstarted/Todo** = committed/active candidate, not yet started
- **Started** = execution in progress or downstream active flow (review/QA/etc.)
- **Completed** = implementation outcome finished
- **Canceled** = intentionally closed without completion
- **Cycle** = planning commitment window
- **Assignee** = person currently responsible
- **Labels** = taxonomy / routing / reporting / domain slices, not lifecycle state

### 3) Recommended policy boundary

If `pi-workflow` wants the convention:

- `Backlog` = unplanned/uncommitted
- `Todo` = pulled into current cycle / near-term execution

that should be documented as a **team policy adapter**, not as Linear truth.

Suggested wording:

> In this workspace, teams may choose to treat Backlog as unplanned work and Todo as cycle-ready work. This is a local operating convention built on top of Linear’s native status and cycle fields, not a platform invariant.

### 4) Recommendations about labels

Based on both native docs and current workspace usage:

- keep labels for taxonomy like bug/support/domain/customer/migration-slice
- avoid using labels as substitutes for `status`, `cycle`, `priority`, or `project` because Linear explicitly reserves those names to avoid confusion [Issue labels](https://linear.app/docs/labels)
- strongly reconsider using `Assign To` labels as a source of truth for ownership, because Linear already has `assignee`

### 5) Recommendations about parent/subissue completion

`pi-workflow` should never assume:

- parent closes when all subissues close
- subissues close when parent closes

unless that team automation is explicitly verified for the target team.

### 6) Recommendations about blockers

Treat blockers as explicit relations, not inferred status:

- a blocked issue may still be in `Todo` or `In Progress`
- being blocked should be represented by `blockedBy` relations, not forced status mutation

This matches Linear’s documented relation model. [Issue relations](https://linear.app/docs/issue-relations)

---

## E. Unverified / open items

The following could not be verified from official docs plus read-only workspace inspection available here:

- which teams have cycle auto-add enabled
- which teams auto-move removed cycle issues back to backlog
- which teams have parent auto-close enabled
- which teams have subissue auto-close enabled
- whether `Migraciones` cycles are disabled or just absent at inspection time
- whether any internal team policy formally defines `Todo` as “must be in current cycle”

These should be treated as workspace conventions or admin settings until explicitly confirmed.
