# #288 parent-review corrective evidence

Entry: branch `288-fix`, head/parent `6d7a0034fc286c7cd8d1a18c82fe9db2eb718b73`, entry tree `c8a459135a1921b2e091e08efa3b8f74441d403d`, production base `464e160d48e2bebf2d0ba23a7f5d47dccd5c8a6e`. Fresh `gh issue view 288 --comments` / `gh issue view 290 --comments` and JSON body/comment reads confirmed the common-source/local-execution decisions (comments 6327927919 and 6327928353). Loaded implement child-run/rounds, TDD/valuable-tests, TypeScript and codebase-design guidance, the specification and existing evidence. Only the three accepted parent findings are applied.

## Findings register

| Finding | Verdict | Correction / simplicity rationale |
| --- | --- | --- |
| STD-1 | Accepted | Restore only the Claude Bridge catalog resolver's original indentation. Formatting-only, no behavioral RED seam; `git diff main -- extensions/pi-workflow.ts` confirms that region has no remaining hunk. No formatter ran. |
| SPEC-5 | Accepted | Contextual children omit the harness custom bash, allowing selected extension bash to override the SDK builtin normally; contextual in-memory settings preserve the native fallback shell/prefix. One conditional at existing construction, no new abstraction or authorization change. Legacy guarded bash remains. |
| SPEC-6 | Accepted | Normalize the local selected paths recipe against the launching project once and share it with toolbox and loader; descendants inherit absolute paths. Spread preserves other fields; no child-toolbox change or second rebasing rule. |
| STD-2 | Rejected | The authority and instruction freshness checks are separate required boundaries; no helper or change. |

Valuable Tests findings: none. The rejected children's register (#290 SPEC-2/local spawn allowed, #290 STD-4, #291 SPEC-2) is untouched. Independent corrective review remains pending; no integration/adoption claim.

## Seams and RED → GREEN

Tests use the existing real SDK parent/child sessions, faux provider only for scripted responses, selected local extension factories/files, and temporary directories/repositories. Expected literals come from the approved local-source contract, not implementation calculations. No raw execute substitutes for dispatch. The relative-path case performs actual parent → child → local grandchild `spawn_child` calls; each executes the selected source locally. An absolute-path control uses the same launch sequence.

Installed SDK 1.0.4 evidence: `dist/core/settings-manager.d.ts` declares `shellPath?: string`, `shellCommandPrefix?: string`, and `SettingsManager.inMemory(settings?: Partial<Settings>, options?: SettingsManagerCreateOptions)`. `settings-manager.js` implements in-memory storage without file I/O; `agent-session.js` reads these getters when constructing builtin bash. Its registry appends custom tools after registered extension tools, explaining the old shadow. The fallback test uses an executable shell wrapper and a prefix with independent literal output to verify both settings end to end.

Commands below used `> /tmp/<log>.log 2>&1; r=$?; tail -N /tmp/<log>.log; exit $r` to preserve exit status.

- Safety net: `node --test test/contextual-authorization.test.mjs test/child-bash.test.mjs` (`/tmp/288-fix-baseline.log`): exit 0, 181/181 pass, 11620.39387 ms runner, 11.7 s wall.
- SPEC-5 RED, before production changes: `node --test --test-name-pattern='selected configured bash|contextual native bash fallback' test/contextual-authorization.test.mjs` (`/tmp/288-spec5-red.log`): exit 1, 0/2 pass, 801.626757 ms runner, 0.8 s wall. Child returned `NATIVE_SHELL` rather than `CONFIGURED_LOCAL_BASH:<child cwd>`; fallback returned `:` rather than `CONFIGURED_PATH:CONFIGURED_PREFIX`.
- SPEC-5 GREEN, same command (`/tmp/288-spec5-green.log`): exit 0, 2/2 pass, 798.985162 ms runner, 0.8 s wall. The first case also proves legacy native execution and the parent-reserved `git push` guard; these are supplemental preservation assertions, not separate claimed REDs.
- SPEC-6 RED, before path correction: `node --test --test-name-pattern='selected source survives' test/contextual-authorization.test.mjs` (`/tmp/288-spec6-red.log`): exit 1, 1 pass/1 failure, 1045.247147 ms runner, 1.1 s wall. Relative source executed in parent and child but not grandchild (`false !== true`); absolute control already passed, so it is preservation coverage, not differential RED.
- SPEC-6 GREEN, same command (`/tmp/288-spec6-green.log`): exit 0, 2/2 pass, 1051.428394 ms runner, 1.1 s wall.

Existing contextual guard and #292 role × bash cases remain unchanged and pass. No obsolete contextual-custom-bash assertion needed updating: existing tests assert observable authorization/guard behavior, not mandatory installation of that custom implementation. Low-level child-bash tests still exercise the retained legacy guard. The new configured-bash and fallback cases cover the contextual selection change.

## Validation

- `npm run check:typecheck`: exit 0; timed repeat 1.213 s wall.
- `node --test test/contextual-authorization.test.mjs test/child-bash.test.mjs test/child-checkpoint.test.mjs test/child-sessions.test.mjs` (`/tmp/288-fix-targeted.log`): exit 0, 428 total, 424 pass, 4 existing skips, 0 failures, 13774.698624 ms runner. Combined typecheck + targeted run took 15.0 s wall.
- `TIMEFORMAT='wall_seconds=%R'; time npm run check:typecheck; time npm run check > /tmp/288-fix-gate-pre-evidence.log 2>&1; r=$?; tail -30 /tmp/288-fix-gate-pre-evidence.log; exit $r`: exit 0, complete gate 19.120 s wall; 1236 total, 1221 pass, 15 existing skips, 0 failures, 15689.694892 ms runner; Biome, TypeScript, Knip, focused-test guard, package/release and packed distribution passed. This precedes this evidence file; the mandatory exact-final-candidate repeat is returned in the checkpoint handoff without changing the tested tree.
- A timing attempt with `/usr/bin/time` exited 127 because that executable is absent; it ran no checks. Repeated with Bash `time` above. No signing/global Git configuration override was needed.

Surface: `extensions/pi-workflow.ts`, `extensions/child-sessions.ts`, `test/contextual-authorization.test.mjs`, and this new evidence file only. No formatter, live inference, install or external writes. Mutation testing is unsupported by repository policy. Parent-owned mechanical staging/comment/whitespace/newline gate and exact-tree confirmation precede the signed checkpoint; independent corrective review and delivery remain pending.
