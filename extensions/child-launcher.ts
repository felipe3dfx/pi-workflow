import { execFile } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
	type ClassifierAnswer,
	type ClassifierContext,
	type ClassifierResult,
	getSupportedThinkingLevels,
	type ModelThinkingLevel,
} from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
	ToolCallEvent,
} from "@earendil-works/pi-coding-agent";

import { latestUserRequest } from "./child-sessions.ts";
import { errorMessage } from "./error-message.ts";
import { gitEnvironment } from "./git-environment.ts";
import type { DelegationMode, JevRouting } from "./workflow-settings.ts";
import type { ModelProfilesLoad, Specialist } from "./model-profiles.ts";
import { seated } from "./shell.ts";
import { offerTool } from "./tool-offer.ts";
import { registerRoutingBlocks } from "./routing-blocks.ts";

export interface LaunchRequest {
	role?: string;
	task: string;
	worktree?: string;
	references?: string[];
	userRequest?: string;
	userMessageId?: string;
}

export interface ChildLauncherOptions {
	modelProfiles: { load: () => ModelProfilesLoad };
	jevRouting: Pick<JevRouting, "enabled">;
	delegationMode: Pick<DelegationMode, "current">;
	contractsDirectory?: string;
}

const roles = ["explore", "worker", "verify"] as const;

type Role = (typeof roles)[number];

const specialistByRole: Record<Role, Specialist> = {
	explore: "explorer",
	worker: "worker",
	verify: "verifier",
};

const reservedOperations = "mutating git or gh, publication";

const destinationInstructions = "Where should this package go?";

const destinationCriteria = {
	decide:
		`A product decision is still open. The parent must ask the user one question and wait. Choosing an architecture with the user is a decision. A reserved operation (${reservedOperations}) is not an open product decision by itself and stays with the parent.`,
	stay: `The package is small and already understood, so the parent can finish it in this session, and the user did not ask for a child session or subagent, nor for an independent review or check of work; or the user explicitly asks the parent to do the work itself in this session, in any language or wording, which takes precedence over the review rule. A reserved operation (${reservedOperations}) in the request stays with the parent, but only that part: the rest of the package is judged on its own.`,
	leave:
		`A bounded package a child session can finish on its own, or the user explicitly asks to delegate to child sessions or subagents, in any language or wording, or the user asks for an independent review or check of work, which must run in a session other than the parent. A reserved operation (${reservedOperations}) in the request stays with the parent, but only that part: the rest of the package is judged on its own. Investigating an architecture can leave.`,
};

const orchestratorStay = `The package needs no work: conversation, an opinion, or a question about what was already said. Or it asks only for reserved operations (${reservedOperations}), such as a commit, a push, or opening a pull request, which stay with the parent. Any other work does not stay, however small.`;

type Contract = { prompt: string; tools: string[] };

const defaultContractsDirectory = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../assets/contracts",
);

type LauncherContext = Pick<
	ExtensionContext,
	"cwd" | "modelRegistry" | "model" | "thinkingLevel" | "signal"
>;

type GateContext = LauncherContext & {
	sessionManager?: Pick<ExtensionContext["sessionManager"], "getBranch">;
};

type Assessment =
	| { kind: "leave"; jev?: ClassifierResult }
	| { kind: "stay" | "decide" | "blocked"; reason: string; jev?: ClassifierResult };

type JevAnswer =
	| { kind: "blocked"; reason: string; jev?: ClassifierResult }
	| {
			kind: "answer";
			destination: "stay" | "decide" | "leave";
			jev: ClassifierResult;
	  };

type Outcome = {
	kind: "stay" | "decide" | "blocked" | "refused";
	warning: string;
	reason: string;
	jev?: ClassifierResult;
};

type Ready = {
	kind: "ready";
	role: Role;
	contract: Contract;
	task: string;
	worktree: string;
	warnings: string[];
	model: string;
	thinking: ModelThinkingLevel;
	chosenBy: "parent";
	references: string[];
	jev?: ClassifierResult;
};

type Pair = { model: string; thinking: ModelThinkingLevel };

const warningFor = {
	stay: "The work stays in this session. No child was launched.",
	decide: "Ask the user one question and wait. No child was launched.",
	blocked: "Launch blocked. No child was launched.",
	refused: "Launch refused. No child was launched.",
} as const;

function outcome(
	kind: keyof typeof warningFor,
	reason: string,
	jev?: ClassifierResult,
): Outcome {
	return { kind, warning: warningFor[kind], reason, ...(jev ? { jev } : {}) };
}

function show(assessment: Exclude<Assessment, { kind: "leave" }>): Outcome {
	return outcome(assessment.kind, assessment.reason, assessment.jev);
}

function isRole(value: string): value is Role {
	return (roles as readonly string[]).includes(value);
}

export function parseContract(text: string): Contract {
	const match = /^---\ntools: (.+)\n---\n([\s\S]*\S[\s\S]*)$/.exec(
		text.replaceAll("\r\n", "\n"),
	);
	const tools = match?.[1].split(",").map((tool) => tool.trim());
	if (!match || !tools || tools.some((tool) => tool === "")) {
		throw new Error("expected a tools line between --- markers, then a prompt");
	}
	return { prompt: match[2].trim(), tools };
}

const execFileAsync = promisify(execFile);

async function gitRoot(worktree: string): Promise<string | Outcome> {
	const invalid = outcome(
		"refused",
		`${worktree} is not a valid worktree: it must be an existing Git root.`,
	);
	try {
		const root = realpathSync(worktree);
		const { stdout } = await execFileAsync(
			"git",
			["rev-parse", "--show-toplevel"],
			{ cwd: root, env: gitEnvironment() },
		);
		return realpathSync(stdout.trim()) === root ? root : invalid;
	} catch {
		return invalid;
	}
}

const gatedTools = new Set([
	"read",
	"grep",
	"find",
	"ls",
	"edit",
	"write",
	"bash",
	"powershell",
]);

function stringField(input: unknown, key: string): string | undefined {
	if (typeof input !== "object" || input === null) return undefined;
	const value = (input as Record<string, unknown>)[key];
	return typeof value === "string" ? value : undefined;
}

function withinCwd(path: string, cwd: string): string | undefined {
	try {
		const rel = relative(cwd, resolve(cwd, path));
		if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
			return undefined;
		}
		return rel;
	} catch {
		return undefined;
	}
}

function resolveReferences(
	references: readonly string[],
	cwd: string,
): string[] | { unreachable: string } {
	try {
		const root = realpathSync(cwd);
		const paths: string[] = [];
		for (const reference of references) {
			try {
				const path = realpathSync(resolve(cwd, reference));
				if (withinCwd(path, root) === undefined) {
					return { unreachable: reference };
				}
				paths.push(path);
			} catch {
				return { unreachable: reference };
			}
		}
		return paths;
	} catch {
		return references.length > 0 ? { unreachable: references[0] } : [];
	}
}

function authorityRead(path: string | undefined, cwd: string): boolean {
	if (!path) return false;
	const rel = withinCwd(path, cwd);
	if (rel === undefined) return false;
	if (rel === "AGENTS.md" || rel === "GLOSSARY.md") return true;
	const parts = rel.split(sep);
	const name = parts[2];
	return (
		parts.length === 3 &&
		parts[0] === "docs" &&
		parts[1] === "agents" &&
		typeof name === "string" &&
		name.endsWith(".md") &&
		name.length > ".md".length
	);
}

function gatedTool(event: ToolCallEvent, cwd: string): boolean {
	if (event.toolName === "codegraph") {
		const operation = stringField(event.input, "operation");
		return operation === "query" || operation === "explore";
	}
	if (!gatedTools.has(event.toolName)) return false;
	if (event.toolName === "read" && authorityRead(stringField(event.input, "path"), cwd)) {
		return false;
	}
	return true;
}

function choiceIn<T extends string>(
	answer: ClassifierAnswer | undefined,
	allowed: readonly T[],
): answer is ClassifierAnswer & { type: "choice"; choice: T } {
	return (
		answer?.type === "choice" &&
		(allowed as readonly string[]).includes(answer.choice)
	);
}

function sessionPair(ctx: LauncherContext): Pair | Outcome {
	if (!ctx.model || !ctx.thinkingLevel) {
		return outcome("refused", "The session has no model and thinking to use.");
	}
	return {
		model: `${ctx.model.provider}/${ctx.model.id}`,
		thinking: ctx.thinkingLevel,
	};
}

function profilePair(
	role: Role,
	profiles: ModelProfilesLoad,
	ctx: LauncherContext,
): Pair | Outcome {
	if (profiles.status !== "loaded") return sessionPair(ctx);
	const { active } = profiles.profiles;
	const specialist = specialistByRole[role];
	const entry = profiles.profiles.profiles[active][specialist];
	if (!entry) return sessionPair(ctx);
	const setting = `Profile ${active} sets ${specialist} to ${entry.model} at ${entry.thinking}`;
	const found = ctx.modelRegistry
		.getAvailable()
		.find(
			(candidate) => `${candidate.provider}/${candidate.id}` === entry.model,
		);
	if (!found) {
		return outcome(
			"refused",
			`${setting}, but that model is not available in Pi.`,
		);
	}
	if (!getSupportedThinkingLevels(found).includes(entry.thinking)) {
		return outcome(
			"refused",
			`${setting}, but that model does not support thinking ${entry.thinking}.`,
		);
	}
	return entry;
}

export function createChildLauncher(options: ChildLauncherOptions) {
	const contractsDirectory =
		options.contractsDirectory ?? defaultContractsDirectory;

	function readContract(role: Role): Contract | Outcome {
		const path = join(contractsDirectory, `${role}.md`);
		try {
			return parseContract(readFileSync(path, "utf8"));
		} catch (error) {
			return outcome(
				"refused",
				`Unable to read the contract for ${role} at ${path}: ${errorMessage(error)}`,
			);
		}
	}

	async function ask(
		request: LaunchRequest,
		ctx: LauncherContext,
	): Promise<JevAnswer> {
		const state: ClassifierContext["state"] = {
			...(request.userRequest ? { user_request: request.userRequest } : {}),
			task: request.task,
		};
		const questions: ClassifierContext["questions"] = {
			destination: {
				type: "choice",
				instructions: destinationInstructions,
				criteria:
					options.delegationMode.current() === "orchestrator"
						? { ...destinationCriteria, stay: orchestratorStay }
						: destinationCriteria,
			},
		};
		const model = ctx.modelRegistry.findOfType(
			"classifier",
			"typesafe",
			"jev-latest",
		);
		if (!model) {
			return {
				kind: "blocked",
				reason:
					"Jev did not answer: typesafe/jev-latest is not in Pi's classifier registry.",
			};
		}
		try {
			const apiKey = await ctx.modelRegistry.getApiKeyForProvider("typesafe");
			if (!apiKey) {
				throw new Error(
					"no TypeSafe API key; run /login and choose TypeSafe or set TYPESAFE_API_KEY",
				);
			}
		} catch (error) {
			return {
				kind: "blocked",
				reason: `Jev did not answer: ${errorMessage(error)}`,
			};
		}
		const jev = await ctx.modelRegistry.classify(
			model,
			{ state, questions },
			{ signal: ctx.signal },
		);
		if (jev.stopReason !== "stop") {
			return {
				kind: "blocked",
				reason: `Jev did not answer: ${jev.errorMessage ?? `stop reason ${jev.stopReason}`}`,
			};
		}
		const destination = jev.answers.destination;
		if (!choiceIn(destination, ["decide", "stay", "leave"] as const)) {
			return { kind: "blocked", reason: "Jev returned an invalid selection.", jev };
		}
		return { kind: "answer", destination: destination.choice, jev };
	}

	async function judge(
		request: LaunchRequest,
		ctx: LauncherContext,
	): Promise<Assessment> {
		if (!options.jevRouting.enabled()) {
			if (request.role !== undefined && isRole(request.role)) {
				return { kind: "leave" };
			}
			return { kind: "stay", reason: "Jev routing is off." };
		}
		const answer = await ask(request, ctx);
		if (answer.kind === "blocked") return answer;
		const { jev } = answer;
		if (answer.destination === "decide") {
			return {
				kind: "decide",
				reason: "Jev answered that a decision is still open.",
				jev,
			};
		}
		if (answer.destination === "stay") {
			return {
				kind: "stay",
				reason:
					"Jev answered that the work for this user message stays. Do it in this session with your own tools.",
				jev,
			};
		}
		return { kind: "leave", jev };
	}

	let turn:
		| { userMessageId: string; pending: Promise<Assessment>; launched?: true }
		| undefined;

	function verdictFor(
		request: LaunchRequest,
		ctx: LauncherContext,
	): Promise<Assessment> {
		const userMessageId = request.userMessageId;
		const bypass =
			!options.jevRouting.enabled() &&
			request.role !== undefined &&
			isRole(request.role);
		if (!bypass && userMessageId && turn?.userMessageId === userMessageId) {
			return turn.pending;
		}
		const pending: Promise<Assessment> = judge(request, ctx).then((verdict) => {
			if (verdict.kind === "blocked" && turn?.pending === pending) {
				turn = undefined;
			}
			return verdict;
		});
		if (!bypass && userMessageId) turn = { userMessageId, pending };
		return pending;
	}

	async function launchVerdict(
		request: LaunchRequest,
		ctx: LauncherContext,
	): Promise<Assessment> {
		const userMessageId = request.userMessageId;
		if (!options.jevRouting.enabled() || !userMessageId) {
			return verdictFor(request, ctx);
		}
		for (;;) {
			if (turn?.userMessageId !== userMessageId) return verdictFor(request, ctx);
			const decided = await turn.pending;
			if (decided.kind !== "blocked") return decided;
		}
	}

	async function gateToolCall(
		event: ToolCallEvent,
		ctx: GateContext,
	): Promise<{ allow: true } | { allow: false; reason: string; destination?: "leave" | "decide" }> {
		if (!seated("child-session", "overlay")) return { allow: true };
		if (!gatedTool(event, ctx.cwd)) return { allow: true };
		const userRequest = latestUserRequest(ctx.sessionManager?.getBranch());
		if (!userRequest) return { allow: true };
		const verdict = await verdictFor(
			{
				task: userRequest.text,
				userRequest: userRequest.text,
				userMessageId: userRequest.id,
			},
			ctx,
		);
		if (verdict.kind === "stay") return { allow: true };
		if (verdict.kind === "leave" && turn?.launched) return { allow: true };
		if (verdict.kind !== "leave") {
			const shown = show(verdict);
			return {
				allow: false,
				reason: `${shown.warning}\n${shown.reason}`,
				...(verdict.kind === "decide" ? { destination: "decide" as const } : {}),
			};
		}
		return {
			allow: false,
			reason:
				"Jev answered that the work for the latest user message leaves this session; a verdict for an earlier message does not carry over. Call spawn_child with the role whose tools cover the task; this message's verdict allows the launch. If procedure instructions are needed, delegate bounded discovery of obligations, prerequisites, sources, and unresolved questions before dependent work.",
			destination: "leave",
		};
	}

	function classify(request: LaunchRequest, ctx: LauncherContext) {
		return verdictFor(request, ctx).then((assessment) =>
			assessment.kind === "leave" ? assessment : show(assessment),
		);
	}

	async function prepareLaunch(
		request: LaunchRequest,
		ctx: LauncherContext,
	): Promise<Ready | Outcome> {
		const role = request.role;
		if (role !== undefined && !isRole(role)) {
			return outcome(
				"refused",
				`unknown role ${role}; expected ${roles.join(", ")}`,
			);
		}
		if (role === undefined && options.jevRouting.enabled()) {
			return outcome("refused", `spawn_child needs a role: ${roles.join(", ")}`);
		}
		const profiles = options.modelProfiles.load();
		if (profiles.status === "refused") return outcome("refused", profiles.reason);
		const references = request.references ?? [];
		const paths = resolveReferences(references, ctx.cwd);
		if (!Array.isArray(paths)) {
			return outcome(
				"refused",
				`reference ${paths.unreachable} does not exist or is outside ${ctx.cwd}`,
			);
		}
		const worktree = await gitRoot(resolve(ctx.cwd, request.worktree ?? "."));
		if (typeof worktree !== "string") return worktree;
		const verdict = await launchVerdict(request, ctx);
		if (verdict.kind !== "leave") return show(verdict);
		if (role === undefined) return outcome("stay", "Jev routing is off.");
		const contract = readContract(role);
		const jev = verdict.jev ? { jev: verdict.jev } : {};
		if ("kind" in contract) return { ...contract, ...jev };
		const pair = profilePair(role, profiles, ctx);
		if ("kind" in pair) return { ...pair, ...jev };
		return {
			kind: "ready",
			role,
			contract,
			task:
				references.length > 0
					? `${request.task}\n\nRead these paths first:\n${paths.map((path) => `- ${path}`).join("\n")}`
					: request.task,
			worktree,
			warnings: [],
			model: pair.model,
			thinking: pair.thinking,
			chosenBy: "parent",
			references,
			...jev,
		};
	}
	function recordLaunch(userMessageId: string | undefined) {
		if (turn && turn.userMessageId === userMessageId) turn.launched = true;
	}
	let gateInstalled = false;
	const childToolsOn = new Map<string, boolean>();

	function childToolsOffer(
		pi: ExtensionAPI,
		tools: readonly { name: string }[],
		children: { waiting(): boolean },
		checkSpawnTools: () => Promise<{ allowed: boolean }>,
	) {
		let allowed = false;
		const recordRoutingBlock = registerRoutingBlocks(pi);

		function refresh() {
			if (!allowed) return;
			const on = seated("child-session", "overlay");
			if (!gateInstalled && !on) return;
			const waiting = children.waiting();
			for (const tool of tools) {
				const offered = on || (waiting && tool.name === "reply_child");
				if (childToolsOn.get(tool.name) === offered) continue;
				childToolsOn.set(tool.name, offered);
				offerTool(pi, tool, offered);
			}
			if (gateInstalled) return;
			gateInstalled = true;
			let gateMessageSent = false;
			pi.on("turn_start", () => {
				gateMessageSent = false;
			});
			pi.on("tool_call", async (event, toolCtx) => {
				const gate = await gateToolCall(event, toolCtx);
				if (gate.allow) return;
				if (gate.destination) recordRoutingBlock(event.toolCallId, gate.destination);
				if (event.parentToolCallId && !gateMessageSent) {
					gateMessageSent = true;
					pi.sendMessage(
						{
							customType: "pi-workflow-gate-block",
							content: gate.reason,
							display: true,
						},
						{ deliverAs: "steer" },
					);
				}
				return { block: true, reason: gate.reason };
			});
		}

		return {
			async offer() {
				allowed = (await checkSpawnTools()).allowed;
				refresh();
			},
			refresh,
			offered: () => tools.every((tool) => childToolsOn.get(tool.name) === true),
		};
	}

	return {
		prepareLaunch,
		recordLaunch,
		gateToolCall,
		classify,
		childToolsOffer,
	};
}
