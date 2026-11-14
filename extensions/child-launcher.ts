import { execFile } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
	getSupportedThinkingLevels,
	type ModelThinkingLevel,
} from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import {
	type CheckpointGrant,
	checkpointContext,
	checkpointGrant,
} from "./child-checkpoint.ts";
import { errorMessage } from "./error-message.ts";
import { gitEnvironment } from "./git-environment.ts";
import type { ModelProfilesLoad, Specialist } from "./model-profiles.ts";
import { seated } from "./shell.ts";
import { offerTool } from "./tool-offer.ts";

export interface LaunchRequest {
	role?: string;
	task: string;
	worktree?: string;
	checkpoint?: string;
	references?: string[];
	surfaces?: string[];
}

export interface ChildLauncherOptions {
	contextual?: boolean;
	modelProfiles: { load: () => ModelProfilesLoad };
	contractsDirectory?: string;
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

type Outcome = {
	kind: "refused";
	warning: string;
	reason: string;
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
	surfaces?: string[];
	checkpoint?: CheckpointGrant;
};

type Pair = { model: string; thinking: ModelThinkingLevel };

function outcome(reason: string): Outcome {
	return {
		kind: "refused",
		warning: "Launch refused. No child was launched.",
		reason,
	};
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

function withinCwd(path: string, cwd: string): string | undefined {
	try {
		const rel = relative(cwd, resolve(cwd, path));
		if (
			rel === "" ||
			rel === ".." ||
			rel.startsWith(`..${sep}`) ||
			isAbsolute(rel)
		) {
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

function sessionPair(ctx: LauncherContext): Pair | Outcome {
	if (!ctx.model || !ctx.thinkingLevel) {
		return outcome("The session has no model and thinking to use.");
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
		return outcome(`${setting}, but that model is not available in Pi.`);
	}
	if (!getSupportedThinkingLevels(found).includes(entry.thinking)) {
		return outcome(
			`${setting}, but that model does not support thinking ${entry.thinking}.`,
		);
	}
	return entry;
}

function missingMcpConfiguration(parent: string, worktree: string) {
	const file = join(".pi", "mcp.json");
	return existsSync(join(parent, file)) && !existsSync(join(worktree, file))
		? [
				`The parent's .pi/mcp.json is absent from the worktree ${worktree}; the child does not inherit it.`,
			]
		: [];
}

export function createChildLauncher(options: ChildLauncherOptions) {
	const contractsDirectory =
		options.contractsDirectory ?? defaultContractsDirectory;

	function readContract(role: Role): Contract | Outcome {
		const path = join(
			contractsDirectory,
			`${options.contextual ? "contextual" : role}.md`,
		);
		try {
			return parseContract(
				readFileSync(path, "utf8").replaceAll("{{role}}", role),
			);
		} catch (error) {
			return outcome(
				`Unable to read the contract for ${role} at ${path}: ${errorMessage(error)}`,
			);
		}
	}

	async function prepareLaunch(
		request: LaunchRequest,
		ctx: LauncherContext,
	): Promise<Ready | Outcome> {
		const role = request.role;
		if (role !== undefined && !isRole(role)) {
			return outcome(`unknown role ${role}; expected ${roles.join(", ")}`);
		}
		if (role === undefined) {
			return outcome(`spawn_child needs a role: ${roles.join(", ")}`);
		}
		const profiles = options.modelProfiles.load();
		if (profiles.status === "refused") return outcome(profiles.reason);
		const references = request.references ?? [];
		const paths = resolveReferences(references, ctx.cwd);
		if (!Array.isArray(paths)) {
			return outcome(
				`reference ${paths.unreachable} does not exist or is outside ${ctx.cwd}`,
			);
		}
		const worktree = await gitRoot(resolve(ctx.cwd, request.worktree ?? "."));
		if (typeof worktree !== "string") return worktree;
		let checkpoint: CheckpointGrant | undefined;
		if (request.checkpoint !== undefined) {
			if (!options.contextual && role !== "worker") {
				return outcome(
					`A checkpoint is granted only to a worker, not to ${role}.`,
				);
			}
			if (!options.contextual && request.worktree === undefined) {
				return outcome(
					"A checkpoint needs the isolated worktree passed explicitly as worktree.",
				);
			}
			try {
				checkpoint = options.contextual
					? await checkpointContext(worktree)
					: await checkpointGrant(worktree, request.checkpoint, ctx.cwd);
				if (checkpoint.branch !== request.checkpoint)
					throw new Error(
						`The assigned context is not on refs/heads/${request.checkpoint}.`,
					);
			} catch (error) {
				return outcome(
					`The checkpoint cannot be granted: ${errorMessage(error)}`,
				);
			}
		}
		const contract = readContract(role);
		if ("kind" in contract) return contract;
		const pair = profilePair(role, profiles, ctx);
		if ("kind" in pair) return pair;
		return {
			kind: "ready",
			role,
			contract,
			task:
				references.length > 0
					? `${request.task}\n\nRead these paths first:\n${paths.map((path) => `- ${path}`).join("\n")}`
					: request.task,
			worktree,
			warnings: missingMcpConfiguration(ctx.cwd, worktree),
			model: pair.model,
			thinking: pair.thinking,
			chosenBy: "parent",
			references,
			...(request.surfaces ? { surfaces: request.surfaces } : {}),
			...(checkpoint ? { checkpoint } : {}),
		};
	}
	let offerStarted = false;
	const childToolsOn = new Map<string, boolean>();

	function childToolsOffer(
		pi: ExtensionAPI,
		tools: readonly { name: string }[],
		children: { waiting(): boolean },
		checkSpawnTools: () => Promise<{ allowed: boolean }>,
	) {
		let allowed = false;

		function refresh() {
			if (!allowed) return;
			const on = seated("child-session", "overlay");
			if (!offerStarted && !on) return;
			const waiting = children.waiting();
			for (const tool of tools) {
				const offered = on || (waiting && tool.name === "reply_child");
				if (childToolsOn.get(tool.name) === offered) continue;
				childToolsOn.set(tool.name, offered);
				offerTool(pi, tool, offered);
			}
			offerStarted = true;
		}

		return {
			async offer() {
				allowed = (await checkSpawnTools()).allowed;
				refresh();
			},
			refresh,
			offered: () =>
				tools.every((tool) => childToolsOn.get(tool.name) === true),
		};
	}

	return {
		prepareLaunch,
		childToolsOffer,
	};
}
