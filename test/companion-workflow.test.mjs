import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
	createCompanionWorkflow as createCompanionWorkflowCore,
} from "../extensions/companion-workflow.ts";
import { createInMemoryCompanionInstallManifestStore } from "../extensions/companion-install-manifest.ts";

const mcpServerCatalog = JSON.parse(
	readFileSync(new URL("../assets/mcp-servers.json", import.meta.url), "utf8"),
);

async function withMetadataFile(companions, run) {
	const dir = await mkdtemp(join(tmpdir(), "pi-workflow-companion-workflow-"));
	try {
		const metadataPath = join(dir, "companions.json");
		await writeFile(
			metadataPath,
			JSON.stringify({ schemaVersion: 1, companions }),
			"utf8",
		);
		return await run({ dir, metadataPath });
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

function createNotifications() {
	const notifications = [];
	return {
		notifications,
		notify: (message, level = "info") => {
			notifications.push({ message, level });
		},
	};
}

function createCompanionWorkflow(options = {}, selectedActions = []) {
	let request;
	let selectedActionId;
	let execution = 0;
	const state = { boundLeases: [], effectLeases: [] };
	const manifests = createInMemoryCompanionInstallManifestStore();
	const confirm = options.interaction?.confirm;
	const decisions = {
		async prepare(nextRequest) {
			request = nextRequest;
			selectedActionId = undefined;
			return {
				decisionId: `companion-test:${"a".repeat(64)}`,
				...nextRequest.presentation,
				choices: nextRequest.presentation.choices.map((choice) => ({
					id: choice.id,
					mode: choice.mode,
					actionId: choice.action.id,
					label: choice.label,
					description: choice.description,
				})),
			};
		},
		async authorize(decisionId, action, actor) {
			if (selectedActionId === undefined) {
				selectedActionId = selectedActions.shift();
				if (selectedActionId === undefined) {
					const accepted = confirm
						? await confirm(
								request.presentation.summary,
								request.presentation.details.join("\n"),
							)
						: false;
					selectedActionId = accepted
						? request.presentation.choices.find(
								(choice) => choice.mode === "execute",
							).action.id
						: "decision.cancel";
				}
			}
			if (action.id !== selectedActionId)
				return {
					kind: "blocked",
					blocker: {
						code: "PI_WORKFLOW_DECISION_CLAIM_MISSING",
						message: "No matching shared claim.",
					},
				};
			if (action.id === "decision.cancel")
				return { kind: "cancelled", decisionId, receipt: {} };
			execution += 1;
			return {
				kind: "authorized",
				lease: {
					decisionId,
					operationDigest: "b".repeat(64),
					executionId: `execution-${execution}`,
					generation: execution,
					actorId: actor.actorId,
					authorityRevision: actor.authorityRevision,
					action,
				},
				receipt: {},
			};
		},
		async bindExecutionManifest(lease, manifest) {
			state.boundLeases.push(lease);
			return { kind: "authorized", lease, manifest };
		},
		async authorizeEffect(lease) {
			state.effectLeases.push(lease);
			return {
				kind: "authorized",
				lease,
				manifest: {
					ref: "workflow://companion-test",
					decisionId: lease.decisionId,
					operationDigest: lease.operationDigest,
					executionId: lease.executionId,
					generation: lease.generation,
				},
			};
		},
		async recover(_scope, _actor, directive) {
			return directive?.kind === "terminal"
				? { kind: "terminal", state: directive.state }
				: { kind: "none" };
		},
		hasActiveDecision: () => false,
	};
	const workflow = createCompanionWorkflowCore({
		...options,
		interaction: options.interaction
			? { ...options.interaction, confirm: undefined }
			: options.interaction,
		authority:
			options.authority ??
			{
				project: "pi-workflow",
				actor: () => ({
					actorId: "companion-test-operator",
					authorityRevision: "companion-test/v1",
					active: true,
					guest: false,
				}),
				hasUI: () => typeof confirm === "function",
				decisions,
				manifests,
			},
	});
	return {
		...workflow,
		testState: state,
		manifests,
		async installMissing() {
			const started = await workflow.installMissing();
			return started.outcome === "awaiting-decision"
				? ((await workflow.continuePending()) ?? started)
				: started;
		},
	};
}

test("inspect reports companion state and status output through the workflow seam", async () => {
	await withMetadataFile(
		[
			{ package: "alpha" },
			{ package: "beta" },
		],
		async ({ metadataPath }) => {
			const { notifications, notify } = createNotifications();
			const workflow = createCompanionWorkflow({
				catalog: {
					metadataPath,
					resolveInstalledVersion: (packageName) => {
						if (packageName === "alpha") return { version: "1.0.0" };
						return {};
					},
				},
				interaction: { notify },
			});

			const result = await workflow.inspect();

			assert.equal(result.level, "warning");
			assert.deepEqual(
				result.states.map(({ package: packageName, status }) => ({
					package: packageName,
					status,
				})),
				[
					{ package: "alpha", status: "installed" },
					{ package: "beta", status: "missing" },
				],
			);
			assert.match(result.message, /Recommended companion packages:/);
			assert.match(result.message, /alpha/);
			assert.match(result.message, /beta/);
			assert.match(result.message, /pi install npm:beta/);
			assert.deepEqual(notifications, [
				{ message: result.message, level: "warning" },
			]);
		},
	);
});

test("diagnose reports CodeGraph readiness through an explicit diagnostic operation", async () => {
	await withMetadataFile(
		[
			{ package: "alpha" },
			{ package: "@vndv/pi-codegraph" },
		],
		async ({ metadataPath }) => {
			const { notifications, notify } = createNotifications();
			const workflow = createCompanionWorkflow({
				catalog: {
					metadataPath,
					resolveInstalledVersion: (packageName) => ({
						version: packageName === "alpha" ? "1.0.0" : "0.1.10",
					}),
				},
				interaction: { notify },
				diagnostics: {
					exec: async () => ({ code: 0, stdout: "codegraph 0.1.0" }),
					cwd: () => "/tmp/project",
					directoryExists: async (path) => path !== "/tmp/project/.codegraph",
				},
			});

			const result = await workflow.diagnose();

			assert.equal(result.level, "warning");
			assert.equal(result.readiness?.cli, "available");
			assert.equal(result.readiness?.index, "missing");
			assert.match(result.message, /pi-workflow companion doctor/);
			assert.match(result.message, /CodeGraph readiness:/);
			assert.match(result.message, /CodeGraph index: missing/);
			assert.deepEqual(notifications, [
				{ message: result.message, level: "warning" },
			]);
		},
	);
});

test("installMissing is a no-op when companions are installed and MCP servers already match the catalog", async () => {
	await withMetadataFile(
		[{ package: "alpha" }],
		async ({ dir, metadataPath }) => {
			const agentDirectory = join(dir, "agent");
			mkdirSync(agentDirectory, { recursive: true });
			await writeFile(
				join(agentDirectory, "mcp.json"),
				`${JSON.stringify({ mcpServers: mcpServerCatalog.mcpServers }, null, 2)}\n`,
				"utf8",
			);
			const { notifications, notify } = createNotifications();
			let confirmCalls = 0;
			const installCalls = [];
			const workflow = createCompanionWorkflow({
				catalog: {
					metadataPath,
					resolveInstalledVersion: () => ({ version: "1.0.0" }),
				},
				interaction: {
					notify,
					confirm: async () => {
						confirmCalls += 1;
						return true;
					},
					installPackage: async (spec) => {
						installCalls.push(spec);
						return { code: 0 };
					},
				},
				mcp: { agentDirectory },
			});

			const result = await workflow.installMissing();

			assert.equal(result.outcome, "noop");
			assert.equal(confirmCalls, 0);
			assert.deepEqual(installCalls, []);
			assert.deepEqual(notifications, [
				{
					message:
						"pi-workflow companions are installed and MCP servers are already configured.",
					level: "info",
				},
			]);
		},
	);
});

test("installMissing installs missing companions and configures MCP servers after confirmation", async () => {
	await withMetadataFile(
		[
			{ package: "alpha" },
			{ package: "beta" },
		],
		async ({ dir, metadataPath }) => {
			const agentDirectory = join(dir, "agent");
			const { notify } = createNotifications();
			const confirmPrompts = [];
			const installCalls = [];
			const workflow = createCompanionWorkflow({
				catalog: {
					metadataPath,
					resolveInstalledVersion: (packageName) => {
						if (packageName === "alpha") return { version: "1.0.0" };
						return {};
					},
				},
				interaction: {
					notify,
					confirm: async (title, message) => {
						confirmPrompts.push({ title, message });
						return true;
					},
					installPackage: async (spec) => {
						installCalls.push(spec);
						return { code: 0 };
					},
				},
				mcp: { agentDirectory },
			});

			const result = await workflow.installMissing();

			assert.equal(result.outcome, "installed");
			assert.equal(confirmPrompts.length, 1);
			assert.match(confirmPrompts[0].title, /install pi-workflow companions and configure mcp servers/i);
			assert.match(confirmPrompts[0].message, /pi install npm:beta/);
			assert.match(confirmPrompts[0].message, /context7/);
			assert.deepEqual(installCalls, ["npm:beta"]);
			const config = JSON.parse(
				await readFile(join(agentDirectory, "mcp.json"), "utf8"),
			);
			assert.deepEqual(config, { mcpServers: mcpServerCatalog.mcpServers });
			assert.match(result.message ?? "", /configured the reviewed MCP plan/i);
		},
	);
});

test("installMissing builds the pi install command from a generic exec capability, the way production wires it", async () => {
	await withMetadataFile(
		[{ package: "alpha" }],
		async ({ dir, metadataPath }) => {
			const agentDirectory = join(dir, "agent");
			mkdirSync(agentDirectory, { recursive: true });
			await writeFile(
				join(agentDirectory, "mcp.json"),
				`${JSON.stringify({ mcpServers: mcpServerCatalog.mcpServers }, null, 2)}\n`,
				"utf8",
			);
			const { notify } = createNotifications();
			const execCalls = [];
			const workflow = createCompanionWorkflow({
				catalog: {
					metadataPath,
					resolveInstalledVersion: () => ({}),
				},
				interaction: {
					notify,
					confirm: async () => true,
					exec: async (command, args) => {
						execCalls.push({ command, args });
						return { code: 0 };
					},
				},
				mcp: { agentDirectory },
			});

			const result = await workflow.installMissing();

			assert.equal(result.outcome, "installed");
			assert.deepEqual(execCalls, [
				{ command: "pi", args: ["install", "npm:alpha"] },
			]);
		},
	);
});

test("installMissing fails closed without shared UI authority", async () => {
	await withMetadataFile(
		[
			{ package: "alpha" },
			{ package: "beta" },
		],
		async ({ dir, metadataPath }) => {
			const agentDirectory = join(dir, "agent");
			const { notifications, notify } = createNotifications();
			const workflow = createCompanionWorkflow({
				catalog: {
					metadataPath,
					resolveInstalledVersion: (packageName) => {
						if (packageName === "alpha") return { version: "1.0.0" };
						return {};
					},
				},
				interaction: {
					notify,
					installPackage: async () => ({ code: 0 }),
				},
				mcp: { agentDirectory },
			});

			const result = await workflow.installMissing();

			assert.equal(result.outcome, "blocked");
			assert.equal(notifications.length, 1);
			assert.match(notifications[0].message, /shared interactive decision authority/i);
			assert.match(notifications[0].message, /no package or MCP effects were authorized/i);
			await assert.rejects(readFile(join(agentDirectory, "mcp.json"), "utf8"));
		},
	);
});

test("installMissing refuses the joint operation when package execution is unavailable", async () => {
	await withMetadataFile(
		[
			{ package: "alpha" },
			{ package: "beta" },
		],
		async ({ dir, metadataPath }) => {
			const agentDirectory = join(dir, "agent");
			const { notifications, notify } = createNotifications();
			let confirmCalls = 0;
			const workflow = createCompanionWorkflow({
				catalog: {
					metadataPath,
					resolveInstalledVersion: (packageName) => {
						if (packageName === "alpha") return { version: "1.0.0" };
						return {};
					},
				},
				interaction: {
					notify,
					confirm: async () => {
						confirmCalls += 1;
						return true;
					},
				},
				mcp: { agentDirectory },
			});

			const result = await workflow.installMissing();

			assert.equal(result.outcome, "blocked");
			assert.equal(confirmCalls, 0);
			assert.equal(notifications.length, 1);
			assert.match(notifications[0].message, /package execution capability is unavailable/i);
			await assert.rejects(readFile(join(agentDirectory, "mcp.json"), "utf8"));
		},
	);
});

test("installMissing preserves unrelated MCP configuration while merging the catalog", async () => {
	await withMetadataFile(
		[{ package: "alpha" }],
		async ({ dir, metadataPath }) => {
			const agentDirectory = join(dir, "agent");
			mkdirSync(agentDirectory, { recursive: true });
			await writeFile(
				join(agentDirectory, "mcp.json"),
				`${JSON.stringify(
					{
						telemetry: { enabled: true },
						mcpServers: {
							custom: { url: "https://example.test/custom" },
						},
					},
					null,
					2,
				)}\n`,
				"utf8",
			);
			const workflow = createCompanionWorkflow({
				catalog: {
					metadataPath,
					resolveInstalledVersion: () => ({ version: "1.0.0" }),
				},
				interaction: {
					notify: () => {},
					confirm: async () => true,
				},
				mcp: { agentDirectory },
			});

			const result = await workflow.installMissing();

			assert.equal(result.outcome, "installed");
			const config = JSON.parse(
				await readFile(join(agentDirectory, "mcp.json"), "utf8"),
			);
			assert.deepEqual(config, {
				telemetry: { enabled: true },
				mcpServers: {
					custom: { url: "https://example.test/custom" },
					...mcpServerCatalog.mcpServers,
				},
			});
		},
	);
});

test("installMissing prepares shared reconciliation when targeted MCP state changes after preview", async () => {
	await withMetadataFile(
		[{ package: "alpha" }],
		async ({ dir, metadataPath }) => {
			const agentDirectory = join(dir, "agent");
			mkdirSync(agentDirectory, { recursive: true });
			const mcpPath = join(agentDirectory, "mcp.json");
			await writeFile(
				mcpPath,
				`${JSON.stringify({ mcpServers: {} }, null, 2)}\n`,
				"utf8",
			);
			const { notifications, notify } = createNotifications();
			const workflow = createCompanionWorkflow({
				catalog: {
					metadataPath,
					resolveInstalledVersion: () => ({ version: "1.0.0" }),
				},
				interaction: {
					notify,
					confirm: async () => {
						// Simulate a concurrent write between the preview plan
						// (taken before this confirm prompt) and the apply step
						// that runs right after this callback returns.
						const firstServerName = Object.keys(
							mcpServerCatalog.mcpServers,
						)[0];
						await writeFile(
							mcpPath,
							`${JSON.stringify(
								{
									mcpServers: {
										[firstServerName]: {
											url: "https://example.test/changed-after-preview",
										},
									},
								},
								null,
								2,
							)}\n`,
							"utf8",
						);
						return true;
					},
				},
				mcp: { agentDirectory },
			});

			const result = await workflow.installMissing();

			assert.equal(result.outcome, "awaiting-decision");
			assert.match(result.message ?? "", /decision prepared/i);
			assert.ok(notifications.every((entry) => entry.level === "info"));

			const stillOnDisk = JSON.parse(await readFile(mcpPath, "utf8"));
			assert.equal(
				stillOnDisk.mcpServers[Object.keys(mcpServerCatalog.mcpServers)[0]]
					.url,
				"https://example.test/changed-after-preview",
			);
		},
	);
});

test("installMissing fails closed when MCP config becomes malformed after approval", async () => {
	await withMetadataFile(
		[{ package: "alpha" }],
		async ({ dir, metadataPath }) => {
			const agentDirectory = join(dir, "agent");
			mkdirSync(agentDirectory, { recursive: true });
			const mcpPath = join(agentDirectory, "mcp.json");
			const { notifications, notify } = createNotifications();
			const workflow = createCompanionWorkflow({
				catalog: {
					metadataPath,
					resolveInstalledVersion: () => ({ version: "1.0.0" }),
				},
				interaction: {
					notify,
					confirm: async () => {
						await writeFile(mcpPath, "{ not valid json", "utf8");
						return true;
					},
				},
				mcp: { agentDirectory },
			});

			const result = await workflow.installMissing();

			assert.equal(result.outcome, "blocked");
			assert.match(
				result.message ?? "",
				/Refusing to overwrite malformed JSON/,
			);
			assert.match(result.message ?? "", /closed before any new effect/i);
			assert.equal(notifications.at(-1).level, "error");

			assert.equal(await readFile(mcpPath, "utf8"), "{ not valid json");
		},
	);
});

test("installMissing prepares reconciliation when the fenced MCP write fails", async () => {
	await withMetadataFile(
		[{ package: "alpha" }],
		async ({ dir, metadataPath }) => {
			const agentDirectory = join(dir, "agent");
			mkdirSync(agentDirectory, { recursive: true });
			const { notifications, notify } = createNotifications();
			const workflow = createCompanionWorkflow({
				catalog: {
					metadataPath,
					resolveInstalledVersion: () => ({ version: "1.0.0" }),
				},
				interaction: {
					notify,
					confirm: async () => {
						chmodSync(agentDirectory, 0o500);
						return true;
					},
				},
				mcp: { agentDirectory },
			});

			try {
				const result = await workflow.installMissing();

				assert.equal(result.outcome, "awaiting-decision");
				assert.match(result.message ?? "", /decision prepared/i);
				assert.ok(notifications.every((entry) => entry.level === "info"));
			} finally {
				chmodSync(agentDirectory, 0o700);
			}
		},
	);
});

test("installMissing returns canceled and leaves packages and MCP untouched when the user declines", async () => {
	await withMetadataFile(
		[
			{ package: "alpha" },
			{ package: "beta" },
		],
		async ({ dir, metadataPath }) => {
			const agentDirectory = join(dir, "agent");
			const confirmPrompts = [];
			const installCalls = [];
			const workflow = createCompanionWorkflow({
				catalog: {
					metadataPath,
					resolveInstalledVersion: (packageName) => {
						if (packageName === "alpha") return { version: "1.0.0" };
						return {};
					},
				},
				interaction: {
					notify: () => {},
					confirm: async (title, message) => {
						confirmPrompts.push({ title, message });
						return false;
					},
					installPackage: async (spec) => {
						installCalls.push(spec);
						return { code: 0 };
					},
				},
				mcp: { agentDirectory },
			});

			const result = await workflow.installMissing();

			assert.equal(result.outcome, "canceled");
			assert.equal(confirmPrompts.length, 1);
			assert.match(
				result.message ?? "",
				/Canceled through the shared decision/,
			);
			assert.deepEqual(installCalls, []);
			await assert.rejects(readFile(join(agentDirectory, "mcp.json"), "utf8"));
		},
	);
});

test("installMissing records non-zero package failure and prepares shared reconciliation", async () => {
	await withMetadataFile(
		[
			{ package: "alpha" },
			{ package: "beta" },
		],
		async ({ dir, metadataPath }) => {
			const agentDirectory = join(dir, "agent");
			const installCalls = [];
			const workflow = createCompanionWorkflow({
				catalog: {
					metadataPath,
					resolveInstalledVersion: (packageName) => {
						if (packageName === "alpha") return { version: "1.0.0" };
						return {};
					},
				},
				interaction: {
					notify: () => {},
					confirm: async () => true,
					installPackage: async (spec) => {
						installCalls.push(spec);
						return { code: 23, stderr: "permission denied" };
					},
				},
				mcp: { agentDirectory },
			});

			const result = await workflow.installMissing();

			assert.equal(result.outcome, "awaiting-decision");
			assert.deepEqual(installCalls, ["npm:beta"]);
			assert.match(result.message ?? "", /decision prepared/i);
			const config = JSON.parse(
				await readFile(join(agentDirectory, "mcp.json"), "utf8"),
			);
			assert.deepEqual(config, { mcpServers: mcpServerCatalog.mcpServers });
		},
	);
});

test("installMissing records thrown package failure and prepares shared reconciliation", async () => {
	await withMetadataFile(
		[
			{ package: "alpha" },
			{ package: "beta" },
		],
		async ({ dir, metadataPath }) => {
			const agentDirectory = join(dir, "agent");
			const installCalls = [];
			const workflow = createCompanionWorkflow({
				catalog: {
					metadataPath,
					resolveInstalledVersion: (packageName) => {
						if (packageName === "alpha") return { version: "1.0.0" };
						return {};
					},
				},
				interaction: {
					notify: () => {},
					confirm: async () => true,
					installPackage: async (spec) => {
						installCalls.push(spec);
						throw new Error("network down");
					},
				},
				mcp: { agentDirectory },
			});

			const result = await workflow.installMissing();

			assert.equal(result.outcome, "awaiting-decision");
			assert.deepEqual(installCalls, ["npm:beta"]);
			assert.match(result.message ?? "", /decision prepared/i);
			const config = JSON.parse(
				await readFile(join(agentDirectory, "mcp.json"), "utf8"),
			);
			assert.deepEqual(config, { mcpServers: mcpServerCatalog.mcpServers });
		},
	);
});

test("installMissing authorizes no package effect when the joint MCP plan is malformed", async () => {
	await withMetadataFile(
		[{ package: "beta" }],
		async ({ dir, metadataPath }) => {
			const agentDirectory = join(dir, "agent");
			mkdirSync(agentDirectory, { recursive: true });
			const mcpPath = join(agentDirectory, "mcp.json");
			await writeFile(mcpPath, "{\n  invalid json\n", "utf8");
			const confirmPrompts = [];
			const installCalls = [];
			const workflow = createCompanionWorkflow({
				catalog: {
					metadataPath,
					resolveInstalledVersion: () => ({}),
				},
				interaction: {
					notify: () => {},
					confirm: async (title, message) => {
						confirmPrompts.push({ title, message });
						return true;
					},
					installPackage: async (spec) => {
						installCalls.push(spec);
						return { code: 0 };
					},
				},
				mcp: { agentDirectory },
			});

			const result = await workflow.installMissing();

			assert.equal(result.outcome, "config-error");
			assert.equal(confirmPrompts.length, 0);
			assert.deepEqual(installCalls, []);
			assert.match(
				result.message ?? "",
				/Refusing to overwrite malformed JSON at .*mcp\.json/,
			);
			assert.match(result.message ?? "", /No package or MCP effects were authorized/);
			assert.equal(await readFile(mcpPath, "utf8"), "{\n  invalid json\n");
		},
	);
});

test("installMissing fails closed when shared decision authorization throws", async () => {
	await withMetadataFile(
		[{ package: "beta" }],
		async ({ dir, metadataPath }) => {
			const agentDirectory = join(dir, "agent");
			const { notifications, notify } = createNotifications();
			const installCalls = [];
			const workflow = createCompanionWorkflow({
				catalog: {
					metadataPath,
					resolveInstalledVersion: () => ({}),
				},
				interaction: {
					notify,
					confirm: async () => {
						throw new Error("confirmation adapter offline");
					},
					installPackage: async (spec) => {
						installCalls.push(spec);
						return { code: 0 };
					},
				},
				mcp: { agentDirectory },
			});

			const result = await workflow.installMissing();

			assert.equal(result.outcome, "blocked");
			assert.deepEqual(installCalls, []);
			assert.equal(notifications.length, 2);
			assert.match(
				notifications.at(-1).message,
				/confirmation adapter offline/,
			);
			assert.match(notifications.at(-1).message, /failed closed/i);
			await assert.rejects(readFile(join(agentDirectory, "mcp.json"), "utf8"));
		},
	);
});

test("installMissing does not report global success when another companion could not be inspected", async () => {
	await withMetadataFile(
		[
			{ package: "alpha" },
			{ package: "beta" },
		],
		async ({ dir, metadataPath }) => {
			const agentDirectory = join(dir, "agent");
			mkdirSync(agentDirectory, { recursive: true });
			await writeFile(
				join(agentDirectory, "mcp.json"),
				`${JSON.stringify({ mcpServers: mcpServerCatalog.mcpServers }, null, 2)}\n`,
				"utf8",
			);
			const installCalls = [];
			const workflow = createCompanionWorkflow({
				catalog: {
					metadataPath,
					resolveInstalledVersion: (packageName) => {
						if (packageName === "alpha") {
							return { error: "package.json unreadable" };
						}
						return {};
					},
				},
				interaction: {
					notify: () => {},
					confirm: async () => true,
					installPackage: async (spec) => {
						installCalls.push(spec);
						return { code: 0 };
					},
				},
				mcp: { agentDirectory },
			});

			const result = await workflow.installMissing();

			assert.equal(result.outcome, "blocked");
			assert.deepEqual(installCalls, []);
			assert.match(
				result.message ?? "",
				/Companion inspection is incomplete/,
			);
			assert.match(
				result.message ?? "",
				/alpha: package\.json unreadable/,
			);
			assert.match(result.message ?? "", /no package or MCP effects were authorized/i);
		},
	);
});

test("one shared lease fences every package and MCP effect in the joint operation", async () => {
	await withMetadataFile(
		[{ package: "alpha" }, { package: "beta" }],
		async ({ dir, metadataPath }) => {
			const workflow = createCompanionWorkflow({
				catalog: { metadataPath, resolveInstalledVersion: () => ({}) },
				interaction: {
					confirm: async () => true,
					installPackage: async () => ({ code: 0 }),
				},
				mcp: { agentDirectory: join(dir, "agent") },
			});

			const outcome = await workflow.installMissing();

			assert.equal(outcome.outcome, "installed");
			assert.equal(workflow.testState.boundLeases.length, 1);
			assert.equal(workflow.testState.effectLeases.length, 3);
			assert.equal(
				new Set(
					workflow.testState.effectLeases.map((lease) => lease.executionId),
				).size,
				1,
			);
			assert.equal(
				workflow.testState.effectLeases[0].executionId,
				workflow.testState.boundLeases[0].executionId,
			);
		},
	);
});

test("shared reconcile retries only incomplete effects and clears durable failures", async () => {
	await withMetadataFile([{ package: "alpha" }], async ({ dir, metadataPath }) => {
		let attempts = 0;
		const workflow = createCompanionWorkflow(
			{
				catalog: { metadataPath, resolveInstalledVersion: () => ({}) },
				interaction: {
					confirm: async () => true,
					installPackage: async () => {
						attempts += 1;
						return attempts === 1
							? { code: 1, stderr: "network down" }
							: { code: 0 };
					},
				},
				mcp: { agentDirectory: join(dir, "agent") },
			},
			["companions.install", "companions.reconcile"],
		);

		assert.equal((await workflow.installMissing()).outcome, "awaiting-decision");
		assert.equal((await workflow.continuePending()).outcome, "installed");
		assert.equal(attempts, 2);
		assert.equal(workflow.testState.boundLeases.length, 2);
	});
});

test("shared wait preserves partial progress and authorizes no recovery effect", async () => {
	await withMetadataFile([{ package: "alpha" }], async ({ dir, metadataPath }) => {
		const agentDirectory = join(dir, "agent");
		const workflow = createCompanionWorkflow(
			{
				catalog: { metadataPath, resolveInstalledVersion: () => ({}) },
				interaction: {
					confirm: async () => true,
					installPackage: async () => ({ code: 1, stderr: "offline" }),
				},
				mcp: { agentDirectory },
			},
			["companions.install", "companions.wait"],
		);

		assert.equal((await workflow.installMissing()).outcome, "awaiting-decision");
		const effectsBeforeWait = workflow.testState.effectLeases.length;
		assert.equal((await workflow.continuePending()).outcome, "waiting");
		assert.equal(workflow.testState.effectLeases.length, effectsBeforeWait);
		const operationId = workflow.testState.boundLeases[0].action.input.operationId;
		assert.equal((await workflow.manifests.read(operationId))?.value.stage, "waiting");
	});
});
