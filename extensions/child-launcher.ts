import { execFile } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
	getSupportedThinkingLevels,
	type ModelThinkingLevel,
} from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { askJevChoice, askJevNouls, type Fetch } from "./jev-client.ts";
import {
	type ModelLists,
	type ModelListsLoad,
	type TaskType,
	taskTypeCriteria,
	taskTypes,
} from "./model-lists.ts";

export interface LaunchRequest {
	role?: string;
	task: string;
	worktree?: string;
}

export interface ChildLauncherOptions {
	modelLists: { load: () => ModelListsLoad };
	contractsDirectory?: string;
	fetch?: Fetch;
}

const roles = ["explore", "worker", "verify"] as const;

type Role = (typeof roles)[number];

type Contract = { prompt: string; tools: string[] };

const defaultContractsDirectory = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../assets/contracts",
);

type LauncherContext = Pick<
	ExtensionContext,
	"cwd" | "modelRegistry" | "model" | "thinkingLevel"
>;

type Refusal = { status: "refused"; warning: string; reason: string };

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

function gitEnvironment(): NodeJS.ProcessEnv {
	const { GIT_DIR: _dir, GIT_WORK_TREE: _workTree, ...env } = process.env;
	return env;
}

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

const stays = (reason: string): Refusal => ({
	status: "refused",
	warning: "The work stays in this session. No child was launched.",
	reason,
});

const typeThreshold = 0.5;

function sessionPair(ctx: LauncherContext): Pair | Refusal {
	if (!ctx.model || !ctx.thinkingLevel) {
		return refused("The session has no model and thinking to use.");
	}
	return {
		model: `${ctx.model.provider}/${ctx.model.id}`,
		thinking: ctx.thinkingLevel,
	};
}

function walk(
	type: TaskType,
	lists: ModelLists | undefined,
	ctx: LauncherContext,
): Pair | Refusal | { unavailable: string } {
	const tier = lists?.taskTypes[type];
	const entries = [
		...(lists?.specialists[type] ?? []),
		...((tier && lists?.tiers[tier]) || []),
	];
	if (entries.length === 0) return sessionPair(ctx);
	const available = ctx.modelRegistry.getAvailable();
	const selected = entries.find(({ model, thinking }) => {
		const found = available.find(
			(candidate) => `${candidate.provider}/${candidate.id}` === model,
		);
		return (
			found !== undefined &&
			getSupportedThinkingLevels(found).includes(thinking)
		);
	});
	return (
		selected ?? {
			unavailable: `No model in the ${type} lists is available in Pi at its thinking level.`,
		}
	);
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

	async function jevVerdict(
		task: string,
		ctx: LauncherContext,
	): Promise<string | Refusal> {
		let apiKey: string | undefined;
		let verdict: string;
		try {
			apiKey = await ctx.modelRegistry.getApiKeyForProvider("typesafe");
			if (!apiKey) {
				throw new Error(
					"no TypeSafe API key; run /login and choose TypeSafe (Jev) or set TYPESAFE_API_KEY",
				);
			}
			verdict = await askJevChoice(
				apiKey,
				{
					state: { task },
					instructions:
						"Should `task` leave the parent session and run in a child session?",
					criteria: {
						stay: "Architecture, an unresolved user decision, or a conflict between agents",
						leave: "Bounded work a child session can finish on its own",
					},
				},
				options.fetch,
			);
		} catch (error) {
			return stays(`Jev did not answer: ${errorMessage(error)}`);
		}
		if (verdict === "leave") return apiKey;
		if (verdict === "stay") return stays("Jev answered that the work stays.");
		return stays(`Jev did not answer: unexpected choice ${verdict}`);
	}

	async function classify(
		task: string,
		apiKey: string,
	): Promise<TaskType | { uncertain: string }> {
		let answers: Record<string, number>;
		try {
			answers = await askJevNouls(
				apiKey,
				{
					state: { task },
					questions: Object.fromEntries(
						taskTypes.map((type) => [
							type,
							{
								instructions: `Is \`task\` ${type} work?`,
								criteria: {
									true: `It is ${type} work: ${taskTypeCriteria[type]}`,
									false: `It is not ${type} work: ${taskTypeCriteria[type]}`,
								},
							},
						]),
					),
				},
				options.fetch,
			);
		} catch (error) {
			return { uncertain: `Jev did not answer: ${errorMessage(error)}` };
		}
		const top = Math.max(...taskTypes.map((type) => answers[type]));
		const leaders = taskTypes.filter((type) => answers[type] === top);
		if (top < typeThreshold) {
			return { uncertain: `no task type reached ${typeThreshold}` };
		}
		if (leaders.length > 1) {
			return { uncertain: `${leaders.join(" and ")} tied` };
		}
		return leaders[0];
	}

	async function decide(request: LaunchRequest, ctx: LauncherContext) {
		const warnings: string[] = [];
		const role = request.role ?? "worker";
		if (request.role === undefined)
			warnings.push("No role was named, so worker is used.");
		if (!isRole(role))
			return refused(`unknown role ${role}; expected ${roles.join(", ")}`);
		const contract = readContract(role);
		if ("status" in contract) return contract;
		const lists = options.modelLists.load();
		if (lists.status === "refused") return refused(lists.reason);
		const worktree = await gitRoot(resolve(ctx.cwd, request.worktree ?? "."));
		if (typeof worktree !== "string") return worktree;
		const apiKey = await jevVerdict(request.task, ctx);
		if (typeof apiKey !== "string") return apiKey;
		const type = await classify(request.task, apiKey);
		let pair: Pair | Refusal | { unavailable: string };
		if (typeof type === "string") {
			pair = walk(
				type,
				lists.status === "loaded" ? lists.lists : undefined,
				ctx,
			);
		} else {
			warnings.push(
				`The task type is uncertain (${type.uncertain}), so the session model and thinking are used.`,
			);
			pair = sessionPair(ctx);
		}
		const plan = { role, contract, task: request.task, worktree, warnings };
		if ("unavailable" in pair) {
			return {
				status: "pending" as const,
				...plan,
				warning: "The work stays pending. No child was launched.",
				reason: pair.unavailable,
			};
		}
		if ("status" in pair) return pair;
		return {
			status: "launch" as const,
			...plan,
			model: pair.model,
			thinking: pair.thinking,
		};
	}
	return { decide };
}
