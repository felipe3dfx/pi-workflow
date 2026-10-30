// Evaluation-only fixture: the scripted endpoint is test support, not a production provider.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, mkdir, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createRpcChildSession,
	installedPi,
} from "../../extensions/rpc-child.ts";
import { modelEndpoint } from "../../test/support/model-endpoint.mjs";

const scenario = process.argv[3] ?? "allow";
if (
	process.argv[2] !== "--scripted" ||
	!["allow", "pending", "release", "endpoint-failure"].includes(scenario)
) {
	console.error(
		"Usage: node integrated.mjs --scripted allow|pending|release|endpoint-failure",
	);
	process.exit(2);
}

const timestamp = () => new Date().toISOString();
async function sha256(path) {
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(path)) hash.update(chunk);
	return hash.digest("hex");
}

const dir = await realpath(await mkdtemp(join(tmpdir(), "pi-auth-capture-")));
const agentDir = join(dir, "agent");
const cwd = join(dir, "work");
const result = {
	status: "incomplete",
	scenario,
	provenance: {
		model: "scripted local endpoint",
		classification: "scripted",
		parentAnswer: "scripted, not human consent",
		scope:
			"real RPC child factory only; parent SDK, live inference and human TUI pending",
	},
	startedAt: timestamp(),
	proposals: [],
	decisions: [],
	questions: [],
	toolOutcomes: [],
	pending: [],
	// Count distinct marker files, not authorization decisions or inferred dispatches.
	effect: { count: 0, content: null },
};
let endpoint;
let handle;
let timer;
let interrupted = false;
const interrupt = () => {
	interrupted = true;
	if (handle) void handle.dispose();
};
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);
try {
	await mkdir(agentDir);
	await mkdir(cwd);
	await mkdir(join(dir, "tmp"));
	process.env.TMPDIR = join(dir, "tmp");
	process.env.PI_CODING_AGENT_DIR = agentDir;
	const binary = installedPi();
	result.provenance.pi = {
		path: binary,
		version: execFileSync(binary, ["--version"], {
			encoding: "utf8",
			timeout: 5000,
		}).trim(),
		sha256: await sha256(binary),
	};
	result.provenance.rpcChildSha256 = await sha256(
		new URL("../../extensions/rpc-child.ts", import.meta.url),
	);
	result.provenance.authorizationSha256 = await sha256(
		new URL("../../extensions/action-authorization.ts", import.meta.url),
	);
	endpoint = await modelEndpoint(agentDir, [
		{ tool: "write", args: { path: "assigned.txt", content: "ASSIGNED" } },
		"DONE",
	]);
	if (scenario === "endpoint-failure") await endpoint.close();
	const known = {
		restriction: "none",
		scope: "within",
		ownership: "assigned",
		effects: "ordinary",
		confirmed: false,
		commit: false,
	};
	handle = await createRpcChildSession({ sessionRoot: join(dir, "sessions") })({
		authorization: {
			authority: () => ({
				assignment: "Write assigned.txt.",
				instructions: [],
			}),
			classify: async (proposal) => {
				const classification =
					scenario === "allow" ||
					scenario === "endpoint-failure" ||
					proposal.consultation
						? { ...known, reason: "Scripted assigned action." }
						: { ...known, scope: "unknown", reason: "Scripted uncertainty." };
				result.proposals.push({ at: timestamp(), proposal, classification });
				return classification;
			},
			onDecision: (decision) =>
				result.decisions.push({ at: timestamp(), decision }),
		},
		cwd,
		project: { cwd, trusted: false },
		role: "explore",
		model: endpoint.model,
		thinking: "off",
		prompt: "You are a contextual child.",
		tools: ["read"],
		shell: {},
		onEvent(event) {
			if (event.type === "tool_execution_end")
				result.toolOutcomes.push({ at: timestamp(), event });
		},
		notify() {},
		report() {},
		checkpointed() {},
		ask: async (text) => {
			const question = JSON.parse(text.slice(text.indexOf("\n") + 1));
			let content = null;
			try {
				content = await readFile(join(cwd, "assigned.txt"), "utf8");
			} catch (error) {
				if (error.code !== "ENOENT") throw error;
			}
			const answer = {
				ref: question.ref,
				kind: scenario === "release" ? "resolved" : "pending",
				answer:
					scenario === "release"
						? "Scripted authorization of this exact write."
						: "Scripted pending answer.",
				confirm: scenario === "release",
			};
			result.questions.push({
				at: timestamp(),
				question,
				answer,
				markerCountWhileHeld: content === null ? 0 : 1,
			});
			return JSON.stringify(answer);
		},
	});
	result.childSessionId = handle.sessionId;
	if (interrupted) throw new Error("Capture cancelled.");
	timer = setTimeout(() => {
		result.deadlineExceeded = true;
		void handle.dispose();
	}, 15_000);
	result.childResult = await handle.run("Perform the assigned local action.");
	result.pending = handle.pendingAuthorizations();
	if (interrupted || result.deadlineExceeded)
		throw new Error("Capture cancelled or deadline exceeded.");
	result.status = "completed";
} catch (error) {
	result.error = String(error?.stack ?? error);
} finally {
	clearTimeout(timer);
	if (handle) {
		result.pending = handle.pendingAuthorizations();
		await handle.dispose();
	}
	try {
		result.effect.content = await readFile(join(cwd, "assigned.txt"), "utf8");
		result.effect.count = 1;
	} catch (error) {
		if (error.code !== "ENOENT") result.effect.error = String(error);
	}
	if (endpoint && scenario !== "endpoint-failure") await endpoint.close();
	result.modelRequests = endpoint?.requests.length ?? 0;
	await rm(dir, { recursive: true, force: true });
	result.scratchRemoved = true;
	result.cancelled = interrupted;
	result.finishedAt = timestamp();
	process.removeListener("SIGINT", interrupt);
	process.removeListener("SIGTERM", interrupt);
}
console.log(JSON.stringify(result));
