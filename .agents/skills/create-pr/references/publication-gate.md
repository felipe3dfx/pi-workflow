# Publication Gate

Read this file before each push to select the publication gate.

## Select the gate

Take the delta from the Gate Base, defined under *Each head runs its own gate*, to the exact head being pushed, and place each changed path in a class; the broadest class any path reaches selects the gate:

- **Tests only.** Every changed file is a test file under the playbook's Test Conventions: run those changed test files, whole, through the Focused Validation path, plus the original reproduction when one exists.
- **Production code.** Run Focused Validation on the touched area plus its callers and consumers.
- **Full.** A dependency manifest or lockfile, a runtime or toolchain version file, build or CI configuration, or configuration shared across the codebase changed: run the full suites the change reaches. When the impact is uncertain, run Full Validation.

When in doubt, run Full Validation. No automatic selection tool decides the class; report the class and the paths that selected it.

## Full suites the change reaches

The document the playbook's Test Conventions name may declare which full suites each path reaches, with the command that runs each suite whole. When every changed path has declared suites, run each suite those paths reach, whole, and no other; a path declared to reach no suite adds none. Otherwise run Full Validation:

- the document declares no suites by path;
- a changed path has no declared suite, or its impact is uncertain, including a conditional mapping the change does not settle;
- the change reaches every declared suite, or configuration they share, such as CI or the command that runs them together.

Report each suite run with the paths that selected it, or why Full Validation ran.

## Each head runs its own gate

Select and run the gate on every pushed head; an earlier head's result never stands in for its run. The Gate Base is the last head this skill pushed after a green gate on that exact SHA, confirmed on the remote, when it is an ancestor of the head being pushed. Otherwise the Gate Base is the Publication Base: the confirmed destination's merge-base with the head. A round whose handoff names no last green pushed head uses the Publication Base. A rebase or force-push breaks ancestry only when it rewrites the green head itself; one that rewrites only later commits keeps it. A merge of the destination into the branch is classified like any other change in the delta. Report the Gate Base used, the green head or the merge-base, and why it was chosen.

A red run of any class counts toward the cap of two consecutive red gate runs and returns to its owner like any red gate. After two consecutive red gate runs of any class, ask the developer before running it again; CI is outside this cap. CI and the required checks still run before merge.
