import { execFile } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
	getSupportedThinkingLevels,
	type ModelThinkingLevel,
} from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { gitEnvironment } from "./git-environment.ts";
import { askJevChoice, type Fetch } from "./jev-client.ts";
import type { ModelProfilesLoad, Specialist } from "./model-profiles.ts";

export interface LaunchRequest {
	role?: string;
	task: string;
	worktree?: string;
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

	async function jevVerdict(
		task: string,
		ctx: LauncherContext,
	): Promise<Refusal | undefined> {
		let verdict: string;
		try {
			const apiKey = await ctx.modelRegistry.getApiKeyForProvider("typesafe");
			if (!apiKey) {
				throw new Error(
					"no TypeSafe API key; run /login and choose TypeSafe or set TYPESAFE_API_KEY",
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
		if (verdict === "leave") return undefined;
		if (verdict === "stay") return stays("Jev answered that the work stays.");
		return stays(`Jev did not answer: unexpected choice ${verdict}`);
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
		const profiles = options.modelProfiles.load();
		if (profiles.status === "refused") return refused(profiles.reason);
		const worktree = await gitRoot(resolve(ctx.cwd, request.worktree ?? "."));
		if (typeof worktree !== "string") return worktree;
		const pair = profilePair(role, profiles, ctx);
		if ("status" in pair) return pair;
		const stay = await jevVerdict(request.task, ctx);
		if (stay) return stay;
		return {
			status: "launch" as const,
			role,
			contract,
			task: request.task,
			worktree,
			warnings,
			model: pair.model,
			thinking: pair.thinking,
		};
	}
	return { decide };
}
