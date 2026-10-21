# Publication Gate

Read this file before each push to select the publication gate.

## Select the gate

Take the delta from the publication base, the confirmed destination's merge-base with the head, to the exact head being pushed, and place each changed path in a class; the broadest class any path reaches selects the gate:

- **Tests only.** Every changed file is a test file under the playbook's Test Conventions: run those changed test files, whole, through the Focused Validation path, plus the original reproduction when one exists.
- **Production code.** Run Focused Validation on the touched area plus its callers and consumers.
- **Full.** A dependency manifest or lockfile, a runtime or toolchain version file, build or CI configuration, or configuration shared across the codebase changed, or the impact is uncertain: run Full Validation.

When in doubt, run Full Validation. No automatic selection tool decides the class; report the class and the paths that selected it.

## Each head stands alone

Select and run the gate on every pushed head. Evidence from an earlier head, review, or round never counts for this one. A red run of any class counts toward the cap of two consecutive red gate runs and returns to its owner like any red gate. CI and the required checks still run before merge.
