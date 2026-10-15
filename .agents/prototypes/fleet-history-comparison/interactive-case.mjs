import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const [mode, root, historyArg = "0", concurrencyArg = "4"] = process.argv.slice(2);
assert.ok(mode === "sdk" || mode === "rpc");
assert.ok(root);
const history = Number(historyArg);
const concurrency = Number(concurrencyArg);
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
process.env.PI_OFFLINE = "1";
process.env.FLEET_FIXTURE_ROOT = root;
process.env.FLEET_OWNED_PROCESS = "1";
mkdirSync(process.env.PI_CODING_AGENT_DIR, { recursive: true });
const { createAgentSession, DefaultResourceLoader, ModelRuntime, RpcClient, SessionManager, SettingsManager } = await import("@earendil-works/pi-coding-agent");
const { fauxAssistantMessage, fauxProvider } = await import("@earendil-works/pi-ai");
const extension = fileURLToPath(new URL("./interactive-provider.mjs", import.meta.url));
const cli = fileURLToPath(new URL("./cli.js", import.meta.resolve("@earendil-works/pi-coding-agent")));
const { openInteractiveView } = await import("./interactive-view.mjs");
const paths = [];
for (let index = 0; index < concurrency; index++) {
	const manager = SessionManager.create(root, join(root, `sessions-${index}`));
	manager.appendMessage({ role: "user", content: "fixture seed", timestamp: Date.now() });
	for (let entry = 0; entry < history; entry++) manager.appendMessage(fauxAssistantMessage([{ type: "thinking", thinking: `reasoning ${entry}` }, { type: "text", text: `history ${entry}: ${"x".repeat(256)}` }]));
	paths.push(manager.getSessionFile());
}
writeFileSync(join(root, "manifest.json"), JSON.stringify({ parent: "fixture-parent", group: "fixture-group", state: "running", paths }));
const handles = [];
let view;
let renderTimer;
let stopping = false;
async function stop() {
	if (stopping) return;
	stopping = true;
	clearInterval(renderTimer);
	view?.close();
	await Promise.all(handles.map((handle) => handle.stop()));
}
process.once("SIGTERM", () => { void stop().finally(() => process.exit(143)); });
const startup = performance.now();
try {
	for (const path of paths) {
		if (mode === "rpc") {
			const client = new RpcClient({
				cliPath: cli, cwd: root, provider: "fleet-fixture", model: "local",
				args: ["--offline", "--no-extensions", "--extension", extension, "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-themes", "--no-mcp", "--tools", "fixture_result", "--session", path],
			});
			handles.push({ client, stop: () => client.stop(), subscribe: (listener) => client.onEvent(listener) });
			await client.start();
			await client.getState();
			await client.setAutoCompaction(false);
			await client.setAutoRetry(false);
		} else {
			const runtime = await ModelRuntime.create({ authPath: join(root, "agent", "auth.json"), modelsPath: null, refreshOnCreate: false });
			const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }, { projectTrusted: false });
			const loader = new DefaultResourceLoader({ cwd: root, agentDir: join(root, "agent"), settingsManager: settings, noExtensions: true, additionalExtensionPaths: [extension], noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
			await loader.reload();
			const model = fauxProvider({ provider: "fleet-fixture", models: [{ id: "local", contextWindow: 10_000_000, maxTokens: 100_000 }] }).getModel();
			const { session } = await createAgentSession({ cwd: root, agentDir: join(root, "agent"), modelRuntime: runtime, model, settingsManager: settings, resourceLoader: loader, sessionManager: SessionManager.open(path), tools: ["fixture_result"] });
			await session.bindExtensions({});
			handles.push({ session, stop: () => session.dispose(), subscribe: (listener) => session.subscribe(listener) });
		}
	}
	const startupMs = performance.now() - startup;
	view = openInteractiveView(SessionManager.open(paths[0]).getEntries(), join(root, "timing.jsonl"));
	const firstFrameStart = performance.now();
	view.render();
	const firstFrameMs = performance.now() - firstFrameStart;
	let events = 0;
	let toolResults = 0;
	let deltas = 0;
	let selectedText = "";
	for (const [index, handle] of handles.entries()) {
		handle.subscribe((event) => {
			events++;
			if (event.type === "tool_execution_end") toolResults++;
			if (index === 0 && event.type === "message_end") {
				view.thread.entries.push({ type: "message", id: `live-${events}`, message: event.message });
				view.thread.streaming = undefined;
				view.render();
			}
			if (event.type === "message_end" && event.message.role === "assistant") assert.ok(["stop", "toolUse"].includes(event.message.stopReason), event.message.errorMessage);
			if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
				deltas++;
				if (index === 0) {
					if (!selectedText) writeFileSync(join(root, "streaming"), "started");
					selectedText += event.assistantMessageEvent.delta;
					// RPC JSON deltas omit SDK message snapshots; normalize identically in both modes.
					view.thread.streaming = fauxAssistantMessage(selectedText, { stopReason: "pending" });
					view.render();
				}
			}
		});
	}
	const lag = monitorEventLoopDelay({ resolution: 1 });
	lag.enable();
	await delay(30);
	lag.reset();
	writeFileSync(join(root, "ready"), "ready");
	const began = performance.now();
	await Promise.all(handles.map((handle) => handle.client ? handle.client.promptAndWait("fixture run", undefined, process.env.FLEET_CRASH ? 3000 : 30_000) : handle.session.prompt("fixture run")));
	const runMs = performance.now() - began;
	clearInterval(renderTimer);
	view.render();
	await delay(10);
	lag.disable();
	assert.equal(selectedText.length, "audit transcript\n".repeat(4096).length);
	const loadedAt = performance.now();
	const entries = paths.map((path) => SessionManager.open(path).getEntries());
	const readAllHistoryMs = performance.now() - loadedAt;
	assert.equal(toolResults, concurrency);
	for (const list of entries) assert.ok(list.some((entry) => entry.type === "message" && entry.message.role === "assistant" && entry.message.content.some((block) => block.type === "text" && block.text === selectedText)));
	writeFileSync(join(root, "manifest.json"), JSON.stringify({ parent: "fixture-parent", group: "fixture-group", state: "completed", paths }));
	writeFileSync(join(root, "result.json"), `${JSON.stringify({ mode, history, concurrency, startupMs, runMs, firstRenderRequestMs: firstFrameMs, rendering: view.stats(), toolResults, events, deltas, selectedChars: selectedText.length, hostLagP99Ms: lag.percentile(99) / 1e6, hostLagMaxMs: lag.max / 1e6, hostRssMiB: process.memoryUsage().rss / 1024 / 1024, readAllHistoryMs, entriesPerChild: entries.map((list) => list.length), node: process.version, platform: process.platform, cwd: resolve(root) })}\n`);
} finally {
	await stop();
}
