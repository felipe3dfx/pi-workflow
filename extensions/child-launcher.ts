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
	ExtensionContext,
	ToolCallEvent,
} from "@earendil-works/pi-coding-agent";

import { latestUserRequest } from "./child-sessions.ts";
import { gitEnvironment } from "./git-environment.ts";
import { jevRoutingEnabled } from "./workflow-settings.ts";
import type { ModelProfilesLoad, Specialist } from "./model-profiles.ts";

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
	contractsDirectory?: string;
	childSessionSeated?: () => boolean;
}

const roles = ["explore", "worker", "verify"] as const;

type Role = (typeof roles)[number];

const specialistByRole: Record<Role, Specialist> = {
	explore: "explorer",
	worker: "worker",
	verify: "verifier",
};

const roleBySpecialist: Record<Specialist, Role> = {
	explorer: "explore",
	worker: "worker",
	verifier: "verify",
};

const reservedOperations = "mutating git or gh, publication";

const specialists = ["explorer", "worker", "verifier"] as const;

const specialistInstructions =
	`Which specialist should carry out the requested action? Choose from the action in \`user_request\` and \`task\`. Reserved operations (${reservedOperations}) are never part of a child package and stay with the parent. \`suggested_specialist\` is a hint and does not decide the answer.`;

const specialistCriteria: Record<Specialist, string> = {
	explorer:
		"Read-only investigation, source comparison, or mapping how something works, including an architecture investigation. Not a review of a pull request or of work that is already done.",
	worker:
		`Implementation, a fix, or another change a child can finish under its contract, excluding reserved operations (${reservedOperations}), which stay with the parent.`,
	verifier:
		"An independent review or check of work that is already done, including a pull request, a diff, or finished changes.",
};

const destinationInstructions = "Where should this package go?";

const destinationCriteria = {
	decide:
		`A product decision is still open. The parent must ask the user one question and wait. Choosing an architecture with the user is a decision. A reserved operation (${reservedOperations}) is not an open product decision by itself and stays with the parent.`,
	stay: `The package is small and already understood, so the parent can finish it in this session, and the user did not ask for a child session or subagent, nor for an independent review or check of work. A reserved operation (${reservedOperations}) in the request stays with the parent, but only that part: the rest of the package is judged on its own.`,
	leave:
		`A bounded package a child session can finish on its own, never including reserved operations (${reservedOperations}), which stay with the parent, or the user explicitly asks to delegate to child sessions or subagents, in any language or wording, or the user asks for an independent review or check of work, which must run in a session other than the parent. Investigating an architecture can leave.`,
};

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
	| { kind: "launch"; role: Role; jev?: ClassifierResult }
	| { kind: "stay" | "decide" | "blocked"; reason: string; jev?: ClassifierResult };

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
	chosenBy: "parent" | "jev";
	references: string[];
	jev?: ClassifierResult;
};

type Pair = { model: string; thinking: ModelThinkingLevel };

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

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

function show(assessment: Exclude<Assessment, { kind: "launch" }>): Outcome {
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

	async function judge(
		request: LaunchRequest,
		ctx: LauncherContext,
	): Promise<Assessment> {
		if (!jevRoutingEnabled()) {
			if (request.role !== undefined && isRole(request.role)) {
				return { kind: "launch", role: request.role };
			}
			return { kind: "stay", reason: "Jev routing is off." };
		}
		const suggested =
			request.role !== undefined && isRole(request.role)
				? specialistByRole[request.role]
				: undefined;
		const state: ClassifierContext["state"] = {
			...(request.userRequest ? { user_request: request.userRequest } : {}),
			task: request.task,
			...(suggested ? { suggested_specialist: suggested } : {}),
			available_specialists: [...specialists],
		};
		const questions: ClassifierContext["questions"] = {
			specialist: {
				type: "choice",
				instructions: specialistInstructions,
				criteria: specialistCriteria,
			},
			destination: {
				type: "choice",
				instructions: destinationInstructions,
				criteria: destinationCriteria,
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
		const specialist = jev.answers.specialist;
		const destination = jev.answers.destination;
		if (
			!choiceIn(specialist, specialists) ||
			!choiceIn(destination, ["decide", "stay", "leave"] as const)
		) {
			return { kind: "blocked", reason: "Jev returned an invalid selection.", jev };
		}
		if (choiceIn(destination, ["decide"] as const)) {
			return {
				kind: "decide",
				reason: "Jev answered that a decision is still open.",
				jev,
			};
		}
		if (choiceIn(destination, ["stay"] as const)) {
			return { kind: "stay", reason: "Jev answered that the work stays.", jev };
		}
		return { kind: "launch", role: roleBySpecialist[specialist.choice], jev };
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
			!jevRoutingEnabled() &&
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

	function beginTurn() {
		// The shared verdict stays until the next operator message.
	}

	async function gateToolCall(
		event: ToolCallEvent,
		ctx: GateContext,
	): Promise<{ allow: true } | { allow: false; reason: string }> {
		if (options.childSessionSeated && !options.childSessionSeated()) {
			return { allow: true };
		}
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
		if (verdict.kind === "launch" && turn?.launched) return { allow: true };
		if (verdict.kind !== "launch") {
			const shown = show(verdict);
			return { allow: false, reason: `${shown.warning}\n${shown.reason}` };
		}
		return {
			allow: false,
			reason: `Call spawn_child. Jev selected the ${verdict.role} role.`,
		};
	}

	function classify(request: LaunchRequest, ctx: LauncherContext) {
		return verdictFor(request, ctx).then((assessment) =>
			assessment.kind === "launch" ? assessment : show(assessment),
		);
	}

	async function prepareLaunch(
		request: LaunchRequest,
		ctx: LauncherContext,
	): Promise<Ready | Outcome> {
		if (request.role !== undefined && !isRole(request.role)) {
			return outcome(
				"refused",
				`unknown role ${request.role}; expected ${roles.join(", ")}`,
			);
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
		const verdict = await verdictFor(request, ctx);
		if (verdict.kind !== "launch") return show(verdict);
		const contract = readContract(verdict.role);
		const jev = verdict.jev ? { jev: verdict.jev } : {};
		if ("kind" in contract) return { ...contract, ...jev };
		const pair = profilePair(verdict.role, profiles, ctx);
		if ("kind" in pair) return { ...pair, ...jev };
		return {
			kind: "ready",
			role: verdict.role,
			contract,
			task:
				references.length > 0
					? `${request.task}\n\nRead these paths first:\n${paths.map((path) => `- ${path}`).join("\n")}`
					: request.task,
			worktree,
			warnings: [],
			model: pair.model,
			thinking: pair.thinking,
			chosenBy: verdict.jev ? "jev" : "parent",
			references,
			...jev,
		};
	}
	function recordLaunch(userMessageId: string | undefined) {
		if (turn && turn.userMessageId === userMessageId) turn.launched = true;
	}
	return { prepareLaunch, recordLaunch, beginTurn, gateToolCall, classify };
}
