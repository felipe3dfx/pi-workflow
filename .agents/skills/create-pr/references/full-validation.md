# Full Validation

Read this file before running the gate whenever it is Full Validation.

## An interrupted run

A Full Validation run that does not finish, because its observer is lost, it times out, or it is cancelled, is interrupted: neither green nor red. Report it to the developer as interrupted, with how it ended.

- An interrupted run never publishes.
- It does not count toward the cap of two consecutive red gate runs.
- The developer decides whether to run it again; never rerun it on your own.
- Green is never inferred from a detached process or from a collection-only result. Only a run observed to finish, with its exit and its summary, is green or red.
