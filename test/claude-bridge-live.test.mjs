import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { fauxProvider } from "@earendil-works/pi-ai";
import { getAgentDir, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { resolveClaudeBridgeExtension } from "../extensions/web-access.ts";
import { installedPackagePath } from "./support/child-session.mjs";
import { createBridgeParentSession } from "./support/bridge-parent.mjs";

const live = process.env.PI_WORKFLOW_BRIDGE_LIVE === "1";

async function disposeSession(session) {
	try {
		const runner = session.extensionRunner;
		if (runner.hasHandlers("session_shutdown")) {
			await runner.emit({ type: "session_shutdown", reason: "quit" });
		}
	} finally {
		session.dispose();
	}
}

const configuredLiveModels = (process.env.PI_WORKFLOW_BRIDGE_LIVE_MODELS ?? "claude-haiku-4-5,claude-sonnet-4-5")
	.split(",")
	.map((model) => model.trim())
	.filter(Boolean);

test("the opt-in Bridge model matrix delivers one bounded real parent request per configured catalog model", {
	skip: !live && "Set PI_WORKFLOW_BRIDGE_LIVE=1 to run real Claude Bridge API delivery checks.",
	timeout: 120_000,
}, async (t) => {
	assert.ok(configuredLiveModels.length > 0 && configuredLiveModels.length <= 2,
		"configure one or two comma-separated catalog model IDs; each gets one external call");
	const sourceAgentDir = getAgentDir();
	const installed = installedPackagePath(sourceAgentDir, "npm:pi-claude-bridge");
	assert.ok(installed, "the actual installed pi-claude-bridge package is required");
	const manifest = JSON.parse(await readFile(join(installed, "package.json"), "utf8"));
	const thinking = process.env.PI_WORKFLOW_BRIDGE_LIVE_THINKING ?? "low";
	assert.ok(["off", "minimal", "low", "medium", "high", "xhigh"].includes(thinking), "set a supported, explicit thinking level");
	const { agentDir, cwd, cleanup } = await prepareBridgeScratch(sourceAgentDir, "pi-workflow-bridge-model-matrix-");
	t.after(cleanup);
	let parent;
	try {
		const project = { cwd, trusted: false };
		const bridgeExtension = await resolveClaudeBridgeExtension(agentDir, project);
		const runtime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
		const native = fauxProvider({ provider: "faux", models: [{ id: "child", reasoning: true }] });
		runtime.registerNativeProvider(native.provider);
		const created = await createBridgeParentSession({
			cwd, agentDir, extensionPath: bridgeExtension, model: native.getModel(), runtime,
		});
		assert.equal(created.loader.getExtensions().errors.length, 0);
		parent = created.session;
		await parent.bindExtensions({});
		for (const modelId of configuredLiveModels) {
			const model = runtime.getModel("claude-bridge", modelId);
			assert.ok(model, `model ${modelId} is not registered by installed Bridge ${manifest.version} in the actual Pi catalog`);
			await parent.setModel(model);
			await parent.setThinkingLevel(thinking);
			await parent.prompt(`Reply exactly with MATRIX_${modelId.replace(/[^a-z0-9]/gi, "_")}_OK.`);
			assert.match(parent.getLastAssistantText() ?? "", new RegExp(`MATRIX_${modelId.replace(/[^a-z0-9]/gi, "_")}_OK`));
		}
		process.stdout.write(`Bridge matrix Bridge=${manifest.version} models=${configuredLiveModels.join(",")} thinking=${thinking} externalCalls=${configuredLiveModels.length}\n`);
	} finally {
		if (parent) await disposeSession(parent);
	}
});

async function prepareBridgeScratch(sourceAgentDir, prefix) {
	const scratch = await mkdtemp(join(tmpdir(), prefix));
	const agentDir = join(scratch, "agent");
	const cwd = join(scratch, "parent");
	const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
	await mkdir(join(agentDir, "npm"), { recursive: true });
	await mkdir(cwd);
	await symlink(join(sourceAgentDir, "npm", "node_modules"), join(agentDir, "npm", "node_modules"), "dir");
	await writeFile(join(agentDir, "settings.json"), JSON.stringify({ packages: ["npm:pi-claude-bridge"] }));
	process.env.PI_CODING_AGENT_DIR = agentDir;
	return {
		scratch, agentDir, cwd,
		async cleanup() {
			if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
			await rm(scratch, { recursive: true, force: true });
		},
	};
}
