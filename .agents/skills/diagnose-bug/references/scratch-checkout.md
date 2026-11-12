# Scratch Checkout Rules

Read this file in full before creating a scratch checkout for `git bisect` or a cross-version or differential run.

A scratch checkout isolates only git: give it the local environment (env files, local settings, dependencies); give each checkout under test disposable copies of all shared external state (data, queues, storage, indexes), never the development ones, and its own port, or run one at a time, since env files copied with unchanged values isolate nothing; run each version against the schema and data state it expects; run the loop by absolute path or from a copy inside the checkout; and confirm the known-good version green and the known-bad version red there before bisecting. On a HITL loop, the developer, never the agent, runs the whole bisect and pastes `git bisect log` and the culprit commit.
