import { execFile } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
	getSupportedThinkingLevels,
	type ModelThinkingLevel,
} from "@earendil-works/pi-ai";
import type {
	ExtensionContext,
	ToolCallEvent,
	ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";

import { latestUserRequest } from "./child-sessions.ts";
import { gitEnvironment } from "./git-environment.ts";
import { askJev, type Fetch, type JevResult } from "./jev-client.ts";
import type { ModelProfilesLoad, Specialist } from "./model-profiles.ts";

export interface LaunchRequest {
	role?: string;
	task: string;
	worktree?: string;
	userRequest?: string;
}

export interface ChildLauncherOptions {
	modelProfiles: { load: () => ModelProfilesLoad };
	contractsDirectory?: string;
	fetch?: Fetch;
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

const specialists = ["explorer", "worker", "verifier"] as const;

const explicitDelegation =
	/\b(?:subagente|subagent|spawn_child|hijo|child)\b|sesi[oó]n hija|child session|\bdeleg/iu;

const specialistInstructions =
	"Which specialist should carry out the requested action? Choose from the action in `user_request` and `task`. `suggested_specialist` is a hint and does not decide the answer.";

const specialistCriteria: Record<Specialist, string> = {
	explorer:
		"Read-only investigation, source comparison, or mapping how something works, including an architecture investigation.",
	worker:
		"Implementation, a fix, or another change a child can finish under its contract.",
	verifier: "An independent check of work that is already done.",
};

const destinationInstructions =
	"Should this package leave the parent session and run in a child?";

const destinationCriteria = {
	stay: "The user still has to make a decision, or the package is not bounded enough for a child to finish alone. Deciding an architecture with the user stays here.",
	leave: "A bounded package a child session can finish on its own. Investigating an architecture can leave.",
};

type Contract = { prompt: string; tools: string[] };

const defaultContractsDirectory = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../assets/contracts",
);

type LauncherContext = Pick<
	ExtensionContext,
	"cwd" | "modelRegistry" | "model" | "thinkingLevel"
>;

type GateContext = LauncherContext & {
	sessionManager?: Pick<ExtensionContext["sessionManager"], "getBranch">;
};

type Verdict =
	| { kind: "launch"; role: Role; jev: JevResult }
	| { kind: "stay"; refusal: Refusal }
	| { kind: "blocked"; refusal: Refusal };

type Refusal = {
	status: "refused";
	warning: string;
	reason: string;
	jev?: JevResult;
};

type Pair = { model: string; thinking: ModelThinkingLevel };

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

const refused = (reason: string): Refusal => ({
	status: "refused",
	warning: "Launch refused. No child was launched.",
	reason,
});

function isRole(value: string): value is Role {
	return (roles as readonly string[]).includes(value);
}

function parseContract(text: string): Contract {
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

async function gitRoot(worktree: string): Promise<string | Refusal> {
	const invalid = refused(
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

const stayWarning = "The work stays in this session. No child was launched.";
const blockedWarning = "Launch blocked. No child was launched.";

const stays = (reason: string, jev?: JevResult): Refusal => ({
	status: "refused",
	warning: stayWarning,
	reason,
	...(jev ? { jev } : {}),
});

const blocked = (reason: string, jev?: JevResult): Refusal => ({
	status: "refused",
	warning: blockedWarning,
	reason,
	...(jev ? { jev } : {}),
});

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

function authorityRead(path: string | undefined, cwd: string): boolean {
	if (!path) return false;
	const rel = withinCwd(path, cwd);
	if (rel === undefined) return false;
	if (rel === "AGENTS.md" || rel === "CONTEXT.md") return true;
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

function delegationIntent(userRequest: string | undefined) {
	return userRequest && explicitDelegation.test(userRequest)
		? "explicit"
		: "optional";
}

function choiceIn<T extends string>(
	answer: JevResult["answers"][string] | undefined,
	allowed: readonly T[],
): answer is JevResult["answers"][string] & { choice: T } {
	return answer !== undefined && (allowed as readonly string[]).includes(answer.choice);
}

function sessionPair(ctx: LauncherContext): Pair | Refusal {
	if (!ctx.model || !ctx.thinkingLevel) {
		return refused("The session has no model and thinking to use.");
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
): Pair | Refusal {
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
		return refused(`${setting}, but that model is not available in Pi.`);
	}
	if (!getSupportedThinkingLevels(found).includes(entry.thinking)) {
		return refused(
			`${setting}, but that model does not support thinking ${entry.thinking}.`,
		);
	}
	return entry;
}

export function createChildLauncher(options: ChildLauncherOptions) {
	const contractsDirectory =
		options.contractsDirectory ?? defaultContractsDirectory;

	function readContract(role: Role): Contract | Refusal {
		const path = join(contractsDirectory, `${role}.md`);
		try {
			return parseContract(readFileSync(path, "utf8"));
		} catch (error) {
			return refused(
				`Unable to read the contract for ${role} at ${path}: ${errorMessage(error)}`,
			);
		}
	}

	async function judge(
		request: LaunchRequest,
		ctx: LauncherContext,
	): Promise<{ role: Role; jev: JevResult } | Refusal> {
		const intent = delegationIntent(request.userRequest);
		const suggested =
			request.role !== undefined && isRole(request.role)
				? specialistByRole[request.role]
				: undefined;
		const state: Record<string, unknown> = {
			...(request.userRequest ? { user_request: request.userRequest } : {}),
			delegation_intent: intent,
			task: request.task,
			...(suggested ? { suggested_specialist: suggested } : {}),
			available_specialists: [...specialists],
		};
		const questions = {
			specialist: {
				instructions: specialistInstructions,
				criteria: specialistCriteria,
			},
			...(intent === "optional"
				? {
						destination: {
							instructions: destinationInstructions,
							criteria: destinationCriteria,
						},
					}
				: {}),
		};
		let jev: JevResult;
		try {
			const apiKey = await ctx.modelRegistry.getApiKeyForProvider("typesafe");
			if (!apiKey) {
				throw new Error(
					"no TypeSafe API key; run /login and choose TypeSafe or set TYPESAFE_API_KEY",
				);
			}
			jev = await askJev(apiKey, state, questions, options.fetch);
		} catch (error) {
			return blocked(`Jev did not answer: ${errorMessage(error)}`);
		}
		const specialist = jev.answers.specialist;
		const destination = jev.answers.destination;
		if (
			!choiceIn(specialist, specialists) ||
			(intent === "optional" &&
				!choiceIn(destination, ["stay", "leave"] as const))
		) {
			return blocked("Jev returned an invalid selection.", jev);
		}
		if (intent === "optional" && destination?.choice === "stay") {
			return stays("Jev answered that the work stays.", jev);
		}
		return { role: roleBySpecialist[specialist.choice], jev };
	}

	function toVerdict(judgment: { role: Role; jev: JevResult } | Refusal): Verdict {
		if (!("status" in judgment)) {
			return { kind: "launch", role: judgment.role, jev: judgment.jev };
		}
		if (judgment.warning === stayWarning) {
			return { kind: "stay", refusal: judgment };
		}
		return { kind: "blocked", refusal: judgment };
	}

	let turn: { userRequest: string; pending: Promise<Verdict> } | undefined;

	function verdictFor(
		request: LaunchRequest,
		ctx: LauncherContext,
	): Promise<Verdict> {
		const userRequest = request.userRequest;
		if (userRequest && turn?.userRequest === userRequest) return turn.pending;
		const pending = judge(request, ctx).then(toVerdict);
		if (userRequest) turn = { userRequest, pending };
		return pending;
	}

	function beginTurn() {
		turn = undefined;
	}

	async function gateToolCall(
		event: ToolCallEvent,
		ctx: GateContext,
	): Promise<ToolCallEventResult | undefined> {
		if (!gatedTool(event, ctx.cwd)) return undefined;
		const userRequest = latestUserRequest(ctx.sessionManager?.getBranch());
		if (!userRequest) return undefined;
		const verdict = await verdictFor({ task: userRequest, userRequest }, ctx);
		if (verdict.kind === "stay") return undefined;
		if (verdict.kind === "blocked") {
			return {
				block: true,
				reason: `${verdict.refusal.warning}\n${verdict.refusal.reason}`,
			};
		}
		return {
			block: true,
			reason: `Call spawn_child. Jev selected the ${verdict.role} role.`,
		};
	}

	async function decide(request: LaunchRequest, ctx: LauncherContext) {
		if (request.role !== undefined && !isRole(request.role)) {
			return refused(`unknown role ${request.role}; expected ${roles.join(", ")}`);
		}
		const profiles = options.modelProfiles.load();
		if (profiles.status === "refused") return refused(profiles.reason);
		const worktree = await gitRoot(resolve(ctx.cwd, request.worktree ?? "."));
		if (typeof worktree !== "string") return worktree;
		const verdict = await verdictFor(request, ctx);
		if (verdict.kind !== "launch") return verdict.refusal;
		const contract = readContract(verdict.role);
		if ("status" in contract) return { ...contract, jev: verdict.jev };
		const pair = profilePair(verdict.role, profiles, ctx);
		if ("status" in pair) return { ...pair, jev: verdict.jev };
		return {
			status: "launch" as const,
			role: verdict.role,
			contract,
			task: request.task,
			worktree,
			warnings: [] as string[],
			model: pair.model,
			thinking: pair.thinking,
			jev: verdict.jev,
		};
	}
	return { decide, beginTurn, gateToolCall };
}
