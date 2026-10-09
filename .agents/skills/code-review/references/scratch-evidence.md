# Scratch Evidence

The Valuable Tests axis reads this file in full before it prepares scratch. It runs each test file the diff adds or changes, whole, against the fixed point's production code.

## Preparation

The harness owns how scratch is prepared. The consumer's `docs/agents/quality.md` owns what runs there: its test commands, execution constraints, and resource limits, and how scratch isolates state shared across checkouts.

- Record the fixed point and the candidate: the candidate's commit, tree, and working-tree status.
- Build scratch from the fixed point's production code and the candidate's added or changed test files with the test support they need, using dependencies compatible with those files.
- Run each file whole. When the consumer's command stops at the first failure, lift only that stop; every other part of the consumer's command, isolation, and limits stays as the consumer defines it.
- Isolate scratch's mutable state, such as databases, services, ports, and caches, from the candidate's and from other runs, using the isolation `docs/agents/quality.md` records under Scratch Evidence. Without a recorded isolation, a run that touches state shared across checkouts, such as a fixed test database name, is missing evidence; never take, recreate, or wait on that state.
- After the runs, record the candidate's identity again. A candidate whose commit, tree, or status changed invalidates the evidence.

## Outcome classes

Classify each test's outcome by its error, not by the runner's count:

- **setup failure**: scratch, its dependencies, or its services could not be prepared, so no test executed. It is neither RED nor a pass. Fix the preparation and rerun, or report the evidence as missing.
- **module-load or missing-name failure**: the file could not load, or a test stopped on a name the fixed point lacks, such as a missing export, attribute, or member. The runner may count it as a failed test; it shows the change is needed somewhere, never that the test is RED.
- **assertion failure**: a test reached the behavior and its assertion failed. Only this is behavioral RED.
- **pass**: the test ran and passed. A test that passes against the fixed point does not test the change.

## Missing evidence

A file whose tests never executed, through a setup failure or no run at all, whose run touched shared state without recorded isolation, or whose candidate identity changed during the runs, is missing evidence, as is every file while `docs/agents/quality.md` records no `supported` Scratch Evidence state; when it has no Scratch Evidence section, also tell the user once to run `setup-workflow update`. Use only the degraded path recorded under Scratch Evidence, never taking, recreating, or waiting on shared state there either; otherwise, or when its blocked-when condition holds, the Valuable Tests axis is **blocked**, naming each file and the outcome classes in it. A module-load or missing-name failure is evidence of its class, not missing evidence. A weaker check, such as a narrower command or a static reading of the test, never stands in for the run.
