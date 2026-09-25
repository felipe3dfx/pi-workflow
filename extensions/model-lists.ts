import { lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
	type Api,
	getSupportedThinkingLevels,
	type Model,
} from "@earendil-works/pi-ai";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { askJevChoice, type Fetch } from "./jev-client.ts";
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

const tierCriteria: Record<Tier, string> = {
	quick: "Mechanical work, transcription, and cheap sweeps",
	standard: "Worker: exploration, implementation, and tests",
	high: "Judge: coordination, review, and risk",
};

const taskTypeCriteria: Record<TaskType, string> = {
	chat: "Conversational answers and quick back-and-forth",
	explain: "Explaining code, concepts, or behavior",
	write: "Writing prose, documentation, or messages",
	operate: "Running commands and operating tools or environments",
	implement: "Implementing features and writing code",
	debug: "Diagnosing and fixing failures",
	refactor: "Restructuring code without changing behavior",
	research: "Reading large sources and gathering findings",
	plan: "Designing approaches and breaking down work",
	review: "Reviewing changes and judging their correctness",
};

const thinkingCriteria: Record<ThinkingLevel, string> = {
	off: "No extended reasoning",
	minimal: "The least extended reasoning the model offers",
	low: "Light reasoning for direct work",
	medium: "Balanced reasoning for everyday work",
	high: "Deep reasoning for demanding work",
	xhigh: "Very deep reasoning",
	max: "The deepest reasoning the model offers",
};

const placementWorkers = 4;

type ModelCandidate = Model<Api>;

type ModelResearch = { thinking: string; notes: string };

type ModelAdapters = {
	research: (
		model: ModelCandidate,
		tier: Tier | undefined,
	) => Promise<ModelResearch>;
	classify: (
		model: ModelCandidate,
		research: ModelResearch,
	) => Promise<string | undefined>;
};

export interface ModelListsOptions {
	path?: string;
	fetch?: Fetch;
	research?: ModelAdapters["research"];
	classify?: ModelAdapters["classify"];
}

type CommandContext = Pick<
	ExtensionCommandContext,
	"hasUI" | "mode" | "ui" | "modelRegistry"
>;

type Placement =
	| {
			model: string;
			taskType: TaskType;
			tier: Tier | undefined;
			entry: ModelEntry;
	  }
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

async function typesafeKey(ctx: CommandContext): Promise<string> {
	const found = await ctx.modelRegistry.getApiKeyForProvider("typesafe");
	if (!found) {
		throw new Error(
			"no TypeSafe API key; run /login and choose TypeSafe (Jev) or set TYPESAFE_API_KEY",
		);
	}
	return found;
}

function price(value: number, kind: string): string {
	return value === 0
		? `cost reported as 0 per million ${kind} tokens`
		: `$${value} per million ${kind} tokens`;
}

function catalogNotes(candidate: ModelCandidate): string {
	return [
		`${candidate.name} (${candidate.provider}/${candidate.id}): reasoning ${candidate.reasoning ? "supported" : "not supported"}`,
		`context window ${candidate.contextWindow} tokens`,
		`max output ${candidate.maxTokens} tokens`,
		`input ${candidate.input.join(", ")}`,
		price(candidate.cost.input, "input"),
		price(candidate.cost.output, "output"),
		`thinking levels ${getSupportedThinkingLevels(candidate).join(", ")}`,
	].join(", ");
}

function jevAdapters(
	ctx: CommandContext,
	fetch: Fetch | undefined,
): ModelAdapters {
	let key: Promise<string> | undefined;
	const apiKey = () => {
		key ??= typesafeKey(ctx);
		return key;
	};
	return {
		async research(candidate, tier) {
			const supported = getSupportedThinkingLevels(candidate);
			const notes = catalogNotes(candidate);
			const thinking = await askJevChoice(
				await apiKey(),
				{
					state: tier
						? { model: notes, tier: `${tier}: ${tierCriteria[tier]}` }
						: { model: notes },
					instructions: `Which thinking level should \`model\` run at by default for delegated work${tier ? " in `tier`" : ""}? Pick only among the offered levels.`,
					criteria: Object.fromEntries(
						supported.map((level) => [level, thinkingCriteria[level]]),
					),
				},
				fetch,
			);
			if (!(supported as string[]).includes(thinking)) {
				throw new Error(`Jev picked unsupported thinking level ${thinking}`);
			}
			return { thinking, notes };
		},
		async classify(_candidate, found) {
			return askJevChoice(
				await apiKey(),
				{
					state: { model: found.notes },
					instructions:
						"Which single task type is `model` best suited for? Judge the kind of work it does best, not its intelligence or speed. Context capacity matters only for which specialist list it belongs to.",
					criteria: taskTypeCriteria,
				},
				fetch,
			);
		},
	};
}

function costTiers(candidates: ModelCandidate[]): Array<Tier | undefined> {
	const priced = candidates
		.filter(({ cost }) => cost.input !== 0 || cost.output !== 0)
		.sort(
			(a, b) => a.cost.output - b.cost.output || a.cost.input - b.cost.input,
		);
	return candidates.map(({ cost }) => {
		const index = priced.findIndex(
			(other) =>
				other.cost.output === cost.output && other.cost.input === cost.input,
		);
		return index === -1
			? undefined
			: tiers[Math.floor((index * tiers.length) / priced.length)];
	});
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

	async function place(
		candidate: ModelCandidate,
		tier: Tier | undefined,
		{ research, classify }: ModelAdapters,
	): Promise<Placement> {
		const model = `${candidate.provider}/${candidate.id}`;
		try {
			const found = await research(candidate, tier);
			if (!isOneOf(thinkingLevels, found.thinking)) {
				return { model, reason: "research found no thinking level" };
			}
			const taskType = await classify(candidate, found);
			if (!isOneOf(taskTypes, taskType)) {
				return { model, reason: "Jev named no known task type" };
			}
			return {
				model,
				taskType,
				tier,
				entry: { model, thinking: found.thinking },
			};
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
		const jev = jevAdapters(ctx, options.fetch);
		const adapters = {
			research: options.research ?? jev.research,
			classify: options.classify ?? jev.classify,
		};
		const lists = emptyLists();
		const leftOut: Array<{ model: string; reason: string }> = [];
		const untiered: string[] = [];
		const candidates = ctx.modelRegistry.getAvailable();
		const candidateTiers = costTiers(candidates);
		const placements: Placement[] = [];
		let next = 0;
		const worker = async () => {
			while (next < candidates.length) {
				const index = next++;
				placements[index] = await place(
					candidates[index],
					candidateTiers[index],
					adapters,
				);
			}
		};
		await Promise.all(Array.from({ length: placementWorkers }, worker));
		for (const placement of placements) {
			if (!("entry" in placement)) {
				leftOut.push(placement);
				continue;
			}
			lists.specialists[placement.taskType]?.push(placement.entry);
			if (placement.tier) lists.tiers[placement.tier]?.push(placement.entry);
			else untiered.push(placement.model);
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
		if (untiered.length > 0) {
			report(
				ctx,
				[
					"No catalog cost, so no tier:",
					...untiered.map((model) => `- ${model}`),
				].join("\n"),
				"warning",
			);
		}
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
		const name = (model: { provider: string; id: string }) =>
			`${model.provider}/${model.id}`;
		const catalog = ctx.modelRegistry.getAvailable().map(name);
		const supportedThinking = Object.fromEntries(
			ctx.modelRegistry
				.getAll()
				.map((model) => [name(model), getSupportedThinkingLevels(model)]),
		);
		for (;;) {
			const action = await ctx.ui.custom<"save" | "exit">(
				(_tui, theme, keybindings, done) =>
					createModelListsEditor(
						lists,
						catalog,
						supportedThinking,
						theme,
						keybindings,
						done,
					),
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
