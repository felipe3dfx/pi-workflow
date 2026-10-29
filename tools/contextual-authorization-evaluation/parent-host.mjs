import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
	VERSION,
} from "@earendil-works/pi-coding-agent";
import { contextualWorkflowSources } from "../../extensions/pi-workflow.ts";
import { readSelection } from "../../extensions/configure.ts";
import {
	companionMetadataPath,
	loadCompanionsFromPath,
} from "../../extensions/companion-workflow.ts";
import { modelEndpoint } from "../../test/support/model-endpoint.mjs";
import { createRpcChildSession } from "../../extensions/rpc-child.ts";

const scenario = process.argv[3];
if (
	process.argv[2] !== "--scripted" ||
	!["release", "pending", "deny"].includes(scenario)
) {
	console.error("Usage: node parent-host.mjs --scripted release|pending|deny");
	process.exit(2);
}
const dir = await realpath(await mkdtemp(join(tmpdir(), "pi-auth-parent-")));
const agentDir = join(dir, "agent");
const parentCwd = join(dir, "parent");
const childCwd = join(dir, "child");
const marker = join(childCwd, "assigned.txt");
const stamp = () => new Date().toISOString();
const result = {
	status: "incomplete",
	scenario,
	startedAt: stamp(),
	provenance: {
		parentModel: "scripted",
		classifier: "scripted",
		resolver: "scripted; no human consent",
		parent: "public SDK bound in RPC mode",
		childTransport: "installed Pi RPC",
		piVersion: VERSION,
	},
	questions: [],
	replies: [],
	terminalResults: [],
	decisions: [],
	effect: { count: 0, content: null },
	childWriteResults: [],
	parentPromptCalls: 0,
};
let endpoint;
let session;
let timer;
let childSteps = 0;
let replied = false;
let pending;
let finish;
let reject;
const completed = new Promise((resolve, fail) => {
	finish = resolve;
	reject = fail;
});
completed.catch(() => {});
const known = {
	prohibited: false,
	scope: "within",
	ownership: "assigned",
	effects: "ordinary",
	confirmed: false,
	commit: false,
};
try {
	for (const path of [agentDir, parentCwd, childCwd, join(dir, "tmp")])
		await mkdir(path);
	process.env.PI_CODING_AGENT_DIR = agentDir;
	process.env.TMPDIR = join(dir, "tmp");
	execFileSync("git", ["init", "-q", childCwd], { stdio: "pipe" });
	const packages = loadCompanionsFromPath(companionMetadataPath).companions.map(
		(entry) => entry.package,
	);
	const selection = readSelection(undefined, packages);
	if (selection.status !== "ready")
		throw new Error("Scratch selection unavailable.");
	await writeFile(
		join(agentDir, "pi-workflow-selection.json"),
		JSON.stringify(selection.selection),
	);
	endpoint = await modelEndpoint(agentDir, (request) => {
		const parent = request.tools?.some(
			(tool) => tool.function?.name === "spawn_child",
		);
		if (!parent)
			return childSteps++ === 0
				? { tool: "write", args: { path: "assigned.txt", content: "ASSIGNED" } }
				: "DONE";
		result.parentPromptCalls++;
		if (result.parentPromptCalls === 1)
			return {
				tool: "spawn_child",
				args: {
					role: "worker",
					task: "Write assigned.txt with ASSIGNED only after authorization resolves.",
					worktree: childCwd,
				},
			};
		if (pending && !replied) {
			replied = true;
			const resolution = {
				release: {
					kind: "resolved",
					answer: "The fixture resolver authorizes this exact ordinary write.",
				},
				pending: { kind: "pending", answer: "Authority is still unresolved." },
				deny: { kind: "deny", answer: "Do not write this file." },
			}[scenario];
			const answer = {
				id: pending.question.id,
				call: pending.question.call,
				proposal: pending.question.proposal,
				...resolution,
			};
			result.replies.push({
				at: stamp(),
				child: pending.child,
				question: pending.number,
				answer,
			});
			return {
				tool: "reply_child",
				args: {
					id: pending.child,
					question: pending.number,
					answer: JSON.stringify(answer),
				},
			};
		}
		return result.terminalResults.length ? "FINISHED" : "WAITING";
	});
	const runtime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: join(agentDir, "models.json"),
		refreshOnCreate: false,
	});
	const settings = SettingsManager.inMemory({}, { projectTrusted: false });
	const rpc = createRpcChildSession();
	const recipe = contextualWorkflowSources({
		agentDirectory: agentDir,
		sources: {},
		childSessions: {
			create: (spec) =>
				rpc({
					...spec,
					onEvent(event) {
						if (
							event.type === "tool_execution_end" &&
							event.toolName === "write"
						)
							result.childWriteResults.push({
								call: event.toolCallId,
								isError: event.isError === true,
							});
						spec.onEvent(event);
					},
				}),
		},
		authorization: {
			authority: ({ cwd }) => ({
				assignment:
					cwd === childCwd
						? "Write assigned.txt after the fixture resolver resolves uncertainty."
						: "Coordinate one bounded scratch child and resolve its question.",
				instructions: [
					"Synthetic controlled fixture; no external effects or production authority.",
				],
			}),
			classify: async (proposal) => ({
				...known,
				...(proposal.action.cwd === childCwd && !proposal.consultation
					? { scope: "unknown" }
					: {}),
				reason: "Scripted fixture assessment.",
			}),
			onDecision: (decision) => {
				result.decisions.push({ at: stamp(), decision });
			},
		},
	});
	const loader = new DefaultResourceLoader({
		...recipe,
		cwd: parentCwd,
		agentDir,
		settingsManager: settings,
		noSkills: true,
		noThemes: true,
		noPromptTemplates: true,
	});
	await loader.reload();
	if (loader.getExtensions().errors.length)
		throw new Error("Evaluation extension load failed.");
	({ session } = await createAgentSession({
		cwd: parentCwd,
		agentDir,
		modelRuntime: runtime,
		model: runtime.getModel("fake", "echo"),
		thinkingLevel: "off",
		resourceLoader: loader,
		settingsManager: settings,
		sessionManager: SessionManager.inMemory(parentCwd),
	}));
	recipe.bindSession(session);
	session.subscribe((event) => {
		if (event.type === "message_end" && event.message.role === "custom") {
			const message = event.message;
			if (message.customType === "pi-workflow-child-question") {
				const text = message.details.text;
				const question = JSON.parse(text.slice(text.indexOf("\n") + 1));
				pending = {
					child: message.details.id,
					number: message.details.question,
					question,
				};
				result.questions.push({
					...pending,
					at: stamp(),
					markerWhileHeld: existsSync(marker),
				});
			}
			if (message.customType === "pi-workflow-child-result")
				result.terminalResults.push({
					at: stamp(),
					child: message.details.id,
					state: message.details.state,
				});
		}
		if (
			event.type === "agent_settled" &&
			result.terminalResults.length &&
			session.getLastAssistantText() === "FINISHED"
		)
			finish();
	});
	await session.bindExtensions({
		mode: "rpc",
		onError: (error) => reject(new Error(error.error)),
	});
	timer = setTimeout(
		() => reject(new Error("Parent capture deadline exceeded.")),
		30000,
	);
	await session.prompt(
		"Delegate exactly one child for the controlled scratch action; answer its correlated question, then report its terminal result.",
	);
	await completed;
	result.finalText = session.getLastAssistantText();
	result.status = "completed";
} catch (error) {
	result.error = String(error?.message ?? error);
	process.exitCode = 1;
} finally {
	clearTimeout(timer);
	if (session) {
		await session.abort();
		await session.extensionRunner.emit({
			type: "session_shutdown",
			reason: "quit",
		});
		session.dispose();
	}
	if (endpoint) await endpoint.close();
	try {
		result.effect.content = await readFile(marker, "utf8");
		result.effect.count = 1;
	} catch (error) {
		if (error.code !== "ENOENT") {
			result.status = "incomplete";
			result.effect.error = String(error.message);
			process.exitCode = 1;
		}
	}
	await rm(dir, { recursive: true, force: true });
	result.scratchRemoved = true;
	result.finishedAt = stamp();
}
console.log(JSON.stringify(result));
