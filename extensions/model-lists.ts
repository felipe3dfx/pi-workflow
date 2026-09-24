import { lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { createModelListsEditor } from "./model-lists-editor.ts";
import {
	activePiAgentDirectory,
	isPlainRecord,
	writeJsonAtomically,
} from "./mcp-config.ts";

const taskTypes = [
	"chat",
	"explain",
	"write",
	"operate",
	"implement",
	"debug",
	"refactor",
	"research",
	"plan",
	"review",
] as const;
const tiers = ["quick", "standard", "high"] as const;
const thinkingLevels = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const;

type TaskType = (typeof taskTypes)[number];
type Tier = (typeof tiers)[number];
type ThinkingLevel = (typeof thinkingLevels)[number];

type ModelEntry = { model: string; thinking: ThinkingLevel };

type ModelLists = {
	schemaVersion: 1;
	specialists: Partial<Record<TaskType, ModelEntry[]>>;
	tiers: Partial<Record<Tier, ModelEntry[]>>;
	taskTypes: Partial<Record<TaskType, Tier>>;
};

const creationMap: Record<TaskType, Tier> = {
	chat: "quick",
	explain: "quick",
	write: "quick",
	operate: "standard",
	implement: "standard",
	debug: "standard",
	refactor: "standard",
	research: "standard",
	plan: "high",
	review: "high",
};

type ModelCandidate = {
	provider: string;
	id: string;
	name: string;
	contextWindow: number;
	reasoning: boolean;
};

type ModelResearch = { thinking: string; notes: string };

export interface ModelListsOptions {
	path?: string;
	research?: (model: ModelCandidate) => Promise<ModelResearch>;
	classify?: (
		model: ModelCandidate,
		research: ModelResearch,
	) => Promise<string | undefined>;
}

type CommandContext = Pick<
	ExtensionCommandContext,
	"hasUI" | "mode" | "ui" | "modelRegistry"
>;

type Placement =
	| { model: string; taskType: TaskType; entry: ModelEntry }
	| { model: string; reason: string };

function isOneOf<T extends string>(
	values: readonly T[],
	value: unknown,
): value is T {
	return (
		typeof value === "string" && (values as readonly string[]).includes(value)
	);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function emptyLists(): ModelLists {
	return {
		schemaVersion: 1,
		specialists: Object.fromEntries(taskTypes.map((type) => [type, []])),
		tiers: Object.fromEntries(tiers.map((tier) => [tier, []])),
		taskTypes: { ...creationMap },
	};
}

function isModelEntry(value: unknown): value is ModelEntry {
	return (
		isPlainRecord(value) &&
		typeof value.model === "string" &&
		value.model.includes("/") &&
		isOneOf(thinkingLevels, value.thinking)
	);
}

function isListSection(value: unknown, keys: readonly string[]): boolean {
	return (
		isPlainRecord(value) &&
		Object.entries(value).every(
			([key, list]) =>
				keys.includes(key) && Array.isArray(list) && list.every(isModelEntry),
		)
	);
}

function isModelLists(value: unknown): value is ModelLists {
	return (
		isPlainRecord(value) &&
		value.schemaVersion === 1 &&
		isListSection(value.specialists, taskTypes) &&
		isListSection(value.tiers, tiers) &&
		isPlainRecord(value.taskTypes) &&
		Object.entries(value.taskTypes).every(
			([type, tier]) => isOneOf(taskTypes, type) && isOneOf(tiers, tier),
		)
	);
}

function parseModelLists(text: string): ModelLists {
	const parsed: unknown = JSON.parse(text);
	if (!isModelLists(parsed)) {
		throw new Error(
			"expected schemaVersion 1 with specialists, tiers, and taskTypes using known names and model/thinking entries",
		);
	}
	return parsed;
}

type ModelListsLoad =
	| { status: "absent" }
	| { status: "loaded"; lists: ModelLists }
	| { status: "refused"; reason: string };

function errorCode(error: unknown): unknown {
	return (error as { code?: unknown }).code;
}

function entryExists(path: string): boolean {
	try {
		lstatSync(path);
		return true;
	} catch (error) {
		if (errorCode(error) === "ENOENT") return false;
		throw error;
	}
}

async function notConfigured(): Promise<never> {
	throw new Error("not configured");
}

export function report(
	ctx: Pick<ExtensionCommandContext, "hasUI" | "ui">,
	message: string,
	level: "info" | "warning" | "error",
) {
	if (ctx.hasUI) ctx.ui.notify(message, level);
	else console.error(message);
}

export function createModelLists(options: ModelListsOptions = {}) {
	const path =
		options.path ??
		resolve(activePiAgentDirectory(), "pi-workflow-models.json");
	const research = options.research ?? notConfigured;
	const classify = options.classify ?? notConfigured;

	async function place(candidate: ModelCandidate): Promise<Placement> {
		const model = `${candidate.provider}/${candidate.id}`;
		try {
			const found = await research(candidate);
			if (!isOneOf(thinkingLevels, found.thinking)) {
				return { model, reason: "research found no thinking level" };
			}
			const taskType = await classify(candidate, found);
			if (!isOneOf(taskTypes, taskType)) {
				return { model, reason: "Jev named no known task type" };
			}
			return { model, taskType, entry: { model, thinking: found.thinking } };
		} catch (error) {
			return { model, reason: errorMessage(error) };
		}
	}

	async function create(ctx: CommandContext) {
		let replacing: boolean;
		try {
			replacing = entryExists(path);
		} catch (error) {
			report(ctx, `Unable to read ${path}: ${errorMessage(error)}`, "error");
			return { status: "refused", leftOut: [] };
		}
		if (replacing && !ctx.hasUI) {
			report(ctx, `${path} exists and was not replaced.`, "warning");
			return { status: "kept", leftOut: [] };
		}
		if (
			replacing &&
			!(await ctx.ui.confirm("Replace model lists?", `Replace ${path}?`))
		) {
			report(ctx, `${path} was not replaced.`, "info");
			return { status: "kept", leftOut: [] };
		}
		const lists = emptyLists();
		const leftOut: Array<{ model: string; reason: string }> = [];
		const placements = await Promise.all(
			ctx.modelRegistry.getAvailable().map((candidate) => place(candidate)),
		);
		for (const placement of placements) {
			if (!("entry" in placement)) {
				leftOut.push(placement);
				continue;
			}
			lists.specialists[placement.taskType]?.push(placement.entry);
			lists.tiers[creationMap[placement.taskType]]?.push(placement.entry);
		}
		try {
			writeJsonAtomically(path, lists, { replace: replacing });
		} catch (error) {
			if (errorCode(error) !== "EEXIST") throw error;
			report(
				ctx,
				`${path} appeared while the lists were being built and was not replaced.`,
				"warning",
			);
			return { status: "kept", leftOut };
		}
		report(
			ctx,
			`${replacing ? "Replaced" : "Created"} ${path}. It applies after /reload.`,
			"info",
		);
		if (leftOut.length > 0) {
			report(
				ctx,
				[
					"Left out of the model lists:",
					...leftOut.map((entry) => `- ${entry.model}: ${entry.reason}`),
				].join("\n"),
				"warning",
			);
		}
		return { status: replacing ? "replaced" : "created", leftOut };
	}

	function readLists(): ModelListsLoad {
		let text: string;
		try {
			if (!entryExists(path)) return { status: "absent" };
			text = readFileSync(path, "utf8");
		} catch (error) {
			return {
				status: "refused",
				reason: `Unable to read ${path}: ${errorMessage(error)}`,
			};
		}
		try {
			return { status: "loaded", lists: parseModelLists(text) };
		} catch (error) {
			return {
				status: "refused",
				reason: `Invalid model lists at ${path}: ${errorMessage(error)}`,
			};
		}
	}

	const snapshot = readLists();

	async function edit(ctx: CommandContext) {
		if (!ctx.hasUI || ctx.mode !== "tui") {
			report(ctx, "The model lists editor needs the TUI.", "error");
			return { status: "refused" };
		}
		const current = readLists();
		if (current.status === "refused") {
			report(ctx, current.reason, "error");
			return { status: "refused" };
		}
		const existed = current.status === "loaded";
		const source = existed ? current.lists : emptyLists();
		const lists = {
			specialists: Object.fromEntries(
				taskTypes.map((type) => [type, [...(source.specialists[type] ?? [])]]),
			),
			tiers: Object.fromEntries(
				tiers.map((tier) => [tier, [...(source.tiers[tier] ?? [])]]),
			),
			taskTypes: { ...source.taskTypes },
		};
		const unchanged = JSON.stringify(lists);
		const available = new Set(
			ctx.modelRegistry
				.getAvailable()
				.map((model) => `${model.provider}/${model.id}`),
		);
		const catalog = ctx.modelRegistry.getAll().map((model) => {
			const name = `${model.provider}/${model.id}`;
			return {
				model: name,
				available: available.has(name),
				thinking: getSupportedThinkingLevels(model),
			};
		});
		for (;;) {
			const action = await ctx.ui.custom<"save" | "exit">(
				(_tui, theme, keybindings, done) =>
					createModelListsEditor(lists, catalog, theme, keybindings, done),
			);
			if (action === "save") break;
			if (
				JSON.stringify(lists) === unchanged ||
				(await ctx.ui.confirm(
					"Discard changes?",
					"The model lists have unsaved changes.",
				))
			) {
				return { status: "cancelled" };
			}
		}
		try {
			writeJsonAtomically(
				path,
				{ schemaVersion: 1, ...lists },
				{ replace: existed },
			);
		} catch (error) {
			if (errorCode(error) !== "EEXIST") throw error;
			report(
				ctx,
				`${path} appeared while editing and was not replaced.`,
				"warning",
			);
			return { status: "kept" };
		}
		report(ctx, `Saved ${path}. It applies after /reload.`, "info");
		return { status: "saved" };
	}

	return { create, load: () => snapshot, edit };
}
