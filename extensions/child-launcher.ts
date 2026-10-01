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
} from "@earendil-works/pi-coding-agent";

import { latestUserRequest } from "./child-sessions.ts";
import { gitEnvironment } from "./git-environment.ts";
import { askJev, type Fetch, type JevResult } from "./jev-client.ts";
import { jevRoutingEnabled } from "./workflow-settings.ts";
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

const destinationInstructions = "Where should this package go?";

const destinationCriteria = {
	decide:
		"A product decision is still open. The parent must ask the user one question and wait. Choosing an architecture with the user is a decision.",
	stay: "The package is small and already understood, so the parent can finish it in this session.",
	leave:
		"A bounded package a child session can finish on its own. Investigating an architecture can leave.",
};

type SkillRoute =
	| { name: string; destination: "stay" }
	| { name: string; destination: "leave" | "approval"; role: Role };

const skillRoutes: SkillRoute[] = [
	{ name: "promotion-readiness", destination: "leave", role: "verify" },
	{ name: "writing-for-agents", destination: "approval", role: "worker" },
	{ name: "mutation-testing", destination: "leave", role: "verify" },
	{ name: "review-critique", destination: "leave", role: "verify" },
	{ name: "domain-modeling", destination: "stay" },
	{ name: "codebase-design", destination: "stay" },
	{ name: "feature-review", destination: "leave", role: "verify" },
	{ name: "setup-workflow", destination: "approval", role: "worker" },
	{ name: "code-review", destination: "leave", role: "verify" },
	{ name: "scope-audit", destination: "leave", role: "explore" },
	{ name: "qa-impact", destination: "leave", role: "explore" },
	{ name: "to-tickets", destination: "stay" },
	{ name: "create-pr", destination: "stay" },
	{ name: "prototype", destination: "approval", role: "worker" },
	{ name: "implement", destination: "leave", role: "worker" },
	{ name: "simplify", destination: "leave", role: "explore" },
	{ name: "to-spec", destination: "approval", role: "worker" },
	{ name: "feature", destination: "stay" },
	{ name: "tdd", destination: "leave", role: "worker" },
];

const skillMatchers = skillRoutes
	.map((route) => ({
		route,
		pattern: new RegExp(
			`(?<![\\p{L}\\p{N}_-])${route.name}(?![\\p{L}\\p{N}_-])`,
			"iu",
		),
	}))
	.sort((left, right) => right.route.name.length - left.route.name.length);

const approval =
	/(?<![\p{L}\p{N}_-])(?:aprobado|approved|publica|publish|hazlo)(?![\p{L}\p{N}_-])/iu;

function matchedSkill(userRequest: string | undefined): SkillRoute | undefined {
	if (!userRequest) return undefined;
	return skillMatchers.find((candidate) => candidate.pattern.test(userRequest))
		?.route;
}

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

type Assessment =
	| { kind: "launch"; role: Role; jev?: JevResult; skill?: string }
	| { kind: "stay" | "decide" | "blocked"; reason: string; jev?: JevResult };

type Outcome = {
	kind: "stay" | "decide" | "blocked" | "refused";
	warning: string;
	reason: string;
	jev?: JevResult;
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
	jev?: JevResult;
	skill?: string;
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
	jev?: JevResult,
): Outcome {
	return { kind, warning: warningFor[kind], reason, ...(jev ? { jev } : {}) };
}

function show(assessment: Exclude<Assessment, { kind: "launch" }>): Outcome {
	return outcome(assessment.kind, assessment.reason, assessment.jev);
}

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

function skillJudgment(userRequest: string | undefined): Assessment | undefined {
	const skill = matchedSkill(userRequest);
	if (!skill) return undefined;
	if (
		skill.destination === "stay" ||
		(skill.destination === "approval" && !approval.test(userRequest ?? ""))
	) {
		return {
			kind: "stay",
			reason: `The ${skill.name} skill keeps this work in the parent.`,
		};
	}
	return { kind: "launch", role: skill.role, skill: skill.name };
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
		const routed = skillJudgment(request.userRequest);
		if (routed) return routed;
		if (!jevRoutingEnabled()) {
			if (request.role !== undefined && isRole(request.role)) {
				return { kind: "launch", role: request.role };
			}
			return { kind: "stay", reason: "Jev routing is off." };
		}
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
			return {
				kind: "blocked",
				reason: `Jev did not answer: ${errorMessage(error)}`,
			};
		}
		const specialist = jev.answers.specialist;
		const destination = jev.answers.destination;
		if (
			!choiceIn(specialist, specialists) ||
			(intent === "optional" &&
				!choiceIn(destination, ["decide", "stay", "leave"] as const))
		) {
			return { kind: "blocked", reason: "Jev returned an invalid selection.", jev };
		}
		if (intent === "optional" && destination?.choice === "decide") {
			return {
				kind: "decide",
				reason: "Jev answered that a decision is still open.",
				jev,
			};
		}
		if (intent === "optional" && destination?.choice === "stay") {
			return { kind: "stay", reason: "Jev answered that the work stays.", jev };
		}
		return { kind: "launch", role: roleBySpecialist[specialist.choice], jev };
	}

	let turn: { userRequest: string; pending: Promise<Assessment> } | undefined;

	function verdictFor(
		request: LaunchRequest,
		ctx: LauncherContext,
	): Promise<Assessment> {
		const userRequest = request.userRequest;
		const bypass =
			!jevRoutingEnabled() &&
			request.role !== undefined &&
			isRole(request.role);
		if (!bypass && userRequest && turn?.userRequest === userRequest) {
			return turn.pending;
		}
		const pending = judge(request, ctx);
		if (!bypass && userRequest) turn = { userRequest, pending };
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
		const verdict = await verdictFor({ task: userRequest, userRequest }, ctx);
		if (verdict.kind === "stay") return { allow: true };
		if (verdict.kind !== "launch") {
			const shown = show(verdict);
			return { allow: false, reason: `${shown.warning}\n${shown.reason}` };
		}
		const selected = verdict.skill
			? `The ${verdict.skill} skill selected the ${verdict.role} role.`
			: `Jev selected the ${verdict.role} role.`;
		return { allow: false, reason: `Call spawn_child. ${selected}` };
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
			task: request.task,
			worktree,
			warnings: [],
			model: pair.model,
			thinking: pair.thinking,
			...jev,
			...(verdict.skill ? { skill: verdict.skill } : {}),
		};
	}
	return { prepareLaunch, beginTurn, gateToolCall, classify };
}
