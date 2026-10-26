# @felipe.3dfx/pi-workflow

A Pi harness package for companion readiness, harness capabilities, child sessions, and terminal chrome. Product workflow remains in Grupo Ilao engineering skills; this package does not publish Linear issues or store workflow artifacts.

## Commands

| Command | What it does | Implementation | Tests |
| --- | --- | --- | --- |
| `/workflow:status` | Summarizes readiness | [`extensions/companion-workflow.ts`](extensions/companion-workflow.ts) | [`test/companion-workflow.test.mjs`](test/companion-workflow.test.mjs) |
| `/workflow:doctor` | Shows companion diagnostics | [`extensions/companion-workflow.ts`](extensions/companion-workflow.ts) | [`test/companion-workflow.test.mjs`](test/companion-workflow.test.mjs) |
| `/workflow:config` | Reviews and applies local companion/capability selection | [`extensions/pi-workflow.ts`](extensions/pi-workflow.ts), [`extensions/configure.ts`](extensions/configure.ts), [`extensions/configure-guide.ts`](extensions/configure-guide.ts), [`extensions/companion-workflow.ts`](extensions/companion-workflow.ts), [`extensions/workflow-settings.ts`](extensions/workflow-settings.ts) | [`test/configure.test.mjs`](test/configure.test.mjs), [`test/companion-workflow.test.mjs`](test/companion-workflow.test.mjs), [`test/workflow-settings.test.mjs`](test/workflow-settings.test.mjs) |
| `/workflow:models` | Edits model profiles | [`extensions/model-profiles.ts`](extensions/model-profiles.ts) | [`test/model-profiles.test.mjs`](test/model-profiles.test.mjs) |
| `/workflow:subagents` | Opens the Fleet view: working children and this parent's read-only history with their audited transcripts | [`extensions/children-view.ts`](extensions/children-view.ts), [`extensions/child-transcript.ts`](extensions/child-transcript.ts) | [`test/children-view.test.mjs`](test/children-view.test.mjs) |
| `/workflow:delegation-check` | Checks fixed Jev delegation cases; does not launch children | [`extensions/delegation-check.ts`](extensions/delegation-check.ts) | [`test/delegation-check.test.mjs`](test/delegation-check.test.mjs) |

Run `/workflow:config` in the TUI to review and apply a selection. Expected missing companions may be installed; MCP servers and default Pi settings are aligned. Nothing is uninstalled. The same menu has a Jev routing row, applied with the rest of the plan; routing is off by default and persists separately from model profiles. Its Delegation mode row is `opportunistic` by default; `orchestrator` tells the parent to delegate all work to child sessions (see [the Delegation mode specification](docs/specs/delegation-mode.md)).

For configuration decisions and behavior, see [ADR 0009](docs/adr/0009-guided-configure.md) and [ADR 0012](docs/adr/0012-consolidate-workflow-command-entrypoint.md). For Jev routing and child-session behavior, see [the routing-owner specification](docs/specs/routing-owner.md) and [child-session delegation specification](docs/specs/child-session-delegation.md). These documents are authoritative; this README is a navigation map, not a duplicate specification.

## Operational setup

- Sign in to TypeSafe with `/login` or provide `TYPESAFE_API_KEY`.
- Sign in to an OAuth MCP server with `/mcp login <server>` (for example, `/mcp login sentry`).
- Sentry and Linear tools use deferred CodeMode and are not directly exposed MCP tools.
- `/workflow:config` applies the package's default Pi settings: `tuiMode: "fullscreen"`, `theme: "pi-workflow"`, `quietStartup: true`, and `defaultTools: ["+codemode"]`.
- Workflow choices are stored in the Pi agent directory: `pi-workflow-selection.json`, `pi-workflow-models.json`, and `pi-workflow-routing.json`.
- Legacy `mcp-adapter.json` configuration is not read; the built-in Pi MCP settings are used. See the warning about `pi-mcp-adapter` below.
- In the default operational path (not the unadopted contextual integration below), child sessions read `git` and GitHub state on their own; inside the child's worktree only listed `git` reads run, only listed `gh` reads run anywhere, and everything else, including `gh auth` and `git credential`, stays with the parent, whether Jev routing is on or off. The child shell's guard covers only the model's own command line, so npm scripts, hooks, and tests it starts run the real `git` and `gh`. It is a policy boundary, not a security boundary: absolute paths, `command git`, `exec git`, `env git`, `gh` aliases, `GIT_*` overrides, descendant processes such as `sh -c`, or running `git -C <repo>` from outside the worktree can bypass it. See [ADR 0013](docs/adr/0013-child-command-policy-for-git-and-gh.md).
- Each child session runs as its own `pi --mode rpc` process in its worktree, as the same user as the parent. It reads the user's global configuration and its worktree's project configuration under the parent's trust, so its MCP servers start in the worktree; a parent project file missing from the worktree, such as an untracked `.pi/mcp.json`, is reported at launch, not inherited. A child's contract still keeps commits, pull requests, and publishing with the parent, except the signed checkpoints a parent grants a worker in an isolated worktree ([ADR 0020](docs/adr/0020-child-owned-signed-checkpoints.md)). `/reload` keeps working children. Writers launched in one worktree need disjoint write surfaces; a writer that declares none claims the whole checkout. See [ADR 0023](docs/adr/0023-children-run-as-rpc-processes.md).
- When the parent exits normally or is killed, and when a child Pi crashes, every child Pi process and its descendants, including MCP servers and shell commands in their own process groups, are stopped within two seconds on Linux and macOS. A cancelled child is asked to abort and its whole process tree is killed after one second. Linux finds descendants by an environment mark, so a descendant that clears its environment escapes it. macOS hides the environment of system binaries, so there the mechanism also follows the process groups it records for each child; a descendant that clears its environment and leaves its group, or that starts a group of its own and is orphaned before the watchdog's next 500 ms check, escapes it. Windows guarantees nothing.

For internal communication and publication-language requirements, see the [Language Contract in `AGENTS.md`](AGENTS.md#language-contract).

## Contextual integration (unadopted)

[ADR 0021](docs/adr/0021-contextual-authorization-from-common-tool-sources.md) and the [contextual authorization specification](docs/specs/contextual-action-authorization.md) define the approved replacement of general role/command permission inventories. This package does not select a classifier model or enable production inference. SDK hosts can supply `contextualWorkflowSources` from `extensions/pi-workflow.ts` to their `DefaultResourceLoader`: it returns common explicit extension paths and local factories, including codemode, tool_search, MCP and the workflow extension. After `createAgentSession`, call the recipe's `bindSession(session)` once, before prompting, after configuring any host `agent.transformContext` transforms. It awaits the existing SDK transform chain and captures final rendered instructions locally, including `context_with_system` and delegation-mode changes; it does not rerun handlers. Keep that binding for the session lifetime (including reloads); do not reassign `agent.transformContext` afterward. Missing/replaced binding or stale instructions hold dispatch. Supply the complete sources selected under the host's existing trust decision; no arbitrary child-worktree extension discovery is added. Each launched child is its own Pi process that loads the selected source paths and evaluates its own calls, consulting the parent for authority and classification. Common tool factories cannot cross into a child process, so a contextual launch that selects them is refused.

The injected authorization adapter may implement `consult(question, signal)` for a held parent action. It must resolve only within its authority, otherwise consult the user through an available channel. Return `{ id, call, proposal, kind, answer, confirmedActions? }` echoing the question's exact identity and proposal; `kind` is `resolved`, `deny`, or `pending`. A resolved answer is reclassified against the unchanged current task/instructions, not treated as execution permission. High-impact actions require both semantic confirmation and an exact `{ tool, input, cwd }` in `confirmedActions` (or prior current task confirmation); scope expansion alone is insufficient. The answer is valid for only that invocation. Missing, failed, cancelled, stale or mismatched responses stay held. Children consult through existing `ask_parent`/`reply_child` correlation using this JSON envelope, not a copied parent resolver closure. Foreground results return `pendingAuthorizations` for explicit parent/user consultation and a fresh authorized spawn; `continue_child` still applies only to retained completed background sessions. Neither result delivery nor continuation automatically replays held actions. No restart persistence or production adoption is implied.

The required `authorization` configuration supplies `authority(ctx)` (current assignment, applicable instructions and optional exact `confirmedActions`, and optional trusted `commit: { paths: string[], context: "noninterfering" | "isolated" }`) and an async `classify(proposal, signal)` semantic adapter. It receives action/tool input and schema/hints as evidence separately from authority, together with the effective session system/project instructions in `context.systemPrompt`, and must assess precedence, scope, effects, ownership, prohibitions and confirmation under the supplied rules. Its result names `scope` (`within`, `outside`, `unknown`), `effects` (`ordinary`, `high-impact`, `unknown`), `ownership` (`assigned`, `other`, `unknown`), boolean `prohibited`/`confirmed`, a visible `reason`, and explicit `commit` intent: `false` for an invocation that does not itself commit, otherwise `{ paths: string[] }`. Missing or malformed intent holds dispatch. Nested tool calls receive their own evaluation. A high-impact release also requires an exact action/target match in the current authority's `confirmedActions`; classifier text cannot create that confirmation. This is an inference seam, not a command parser, a default permit adapter or an accuracy claim.

Every covered parent/child dispatch, including local nested and dynamic/MCP tools, passes the shared authorization hook. Jev's destination block still applies independently. Uncertainty, malformed/failed classification and cancellation retain an `Authorization held` reason and a `pi-workflow-authorization` entry without executing; failures are not consent or permanent action refusal. Consultation/resume uses the #291 envelope above; [ADR 0022](docs/adr/0022-task-authorized-signed-commits.md) replaces commit role/tool/grant exclusivity in this injected path. Any role can commit through ordinary bash, compatible local tools or the optional checkpoint convenience when current task authority authorizes the scoped action. The assigned context may be shared when noninterfering; isolate wherever interference is possible. Trusted authority must identify task-owned paths and establish that context, not infer either from classifier output or tool availability. The repository identity, branch and base are captured at session start and verified before each commit. Paths are relative to that assigned Git root; a directory asserts ownership of all included changes, so use exact owned files when ownership is mixed. Repository preflight checks signing configuration and the existing index before staging; shared postcommit verification reports signature-header, scope, parent, branch or other-ref failures with the SHA and no rollback. Verification also runs after an executed tool throws or is cancelled. Within one Pi process, a competing commit that shares Git metadata is held, not serialized into permission, and a call that does not execute releases its reservation when its tool execution ends; each child is its own process, so commits from different children are not held against each other. These checks are non-atomic, do not verify signer identity, and do not sandbox arbitrary extension code, hooks, shell descendants or external processes. The semantic adapter must identify actual direct commit effects, including overrides or different repository targets; command text is not proof of effects. Real adoption comparison belongs to #293. No tool availability authorizes commit or publication.

A contextual child has no child toolbox and cannot launch grandchildren. Registered, active, callable and UI-ready tools differ; genuine deferred MCP uses tool_search, and recursive codemode scripts are not callable in Pi 1.4.0. Hooks do not sandbox raw extension code, shell descendants, hooks, external services or module globals; never call retrieved definitions' `execute` directly as a dispatch substitute. Scripted tests validate covered integration, not real semantic accuracy, human consent or production readiness.

## Model profiles

`/workflow:models` assigns a model and thinking level to each child specialist. See the [child-session delegation specification](docs/specs/child-session-delegation.md) for role selection, Jev behavior, and launch rules.

## Theme and chrome

The package ships the `pi-workflow` theme and restyles Pi's terminal UI. The chrome patches Pi internals copied from Pi 1.4.0 without a version guard; re-verify them on every Pi upgrade. See [ADR 0007](docs/adr/0007-patch-pi-tui-internals-for-chrome.md).

## Colliding packages

Status, doctor, and config warn about packages that overlap with harness functionality. Config never removes them.

- `@heyhuynhgiabuu/pi-pretty` registers the same tool names.
- `pi-powerline-footer` replaces the same header, footer, and editor.
- `pi-mcp-adapter` replaces Pi's built-in `/mcp`, so Pi ignores `mcp.json` while it is installed.

## Install

```bash
pi install npm:@felipe.3dfx/pi-workflow
```

Reload Pi, then inspect the harness with `/workflow:status`. Install engineering skills from the Grupo Ilao catalog into the consumer repository; this package does not bundle them. The 0.1.x product workflow commands and `pi-workflow-sync` are gone.

## Disposable Pi test launcher

```bash
npm run pi:sandbox
```

The launcher isolates Pi home, configuration, packages, and sessions. It is not a filesystem security sandbox.

## Requirements

- Node.js `>=22.19`
- Pi CLI `>=1.4.0` available in the target environment
