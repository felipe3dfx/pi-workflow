import { lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
	getSupportedThinkingLevels,
	type ModelThinkingLevel,
} from "@earendil-works/pi-ai";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { claim, held } from "./configure.ts";
import { isPlainRecord, writeJsonAtomically } from "./agent-directory.ts";
import { createModelProfilesEditor } from "./model-profiles-editor.ts";

const profileOverlay = claim("model-profiles", "overlay");

export const specialists = ["explorer", "worker", "verifier"] as const;
const thinkingLevels: readonly ModelThinkingLevel[] = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
];

export type Specialist = (typeof specialists)[number];

type ModelEntry = { model: string; thinking: ModelThinkingLevel };

type Profile = Partial<Record<Specialist, ModelEntry>>;

export type EditableProfiles = {
	active: string;
	profiles: Record<string, Profile>;
};

export type ModelProfiles = { schemaVersion: 2 } & EditableProfiles;

export const profileName = /^[a-z0-9-]{1,64}$/;

export const UNSAFE_TERMINAL_CHARACTERS = /[\p{Cc}\p{Bidi_Control}]/gu;

type CommandContext = Pick<
	ExtensionCommandContext,
	"hasUI" | "mode" | "ui" | "modelRegistry"
>;

function isOneOf<T extends string>(
	values: readonly T[],
	value: unknown,
): value is T {
	return (
		typeof value === "string" && (values as readonly string[]).includes(value)
	);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
	return Object.keys(value).every((key) => keys.includes(key));
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function isModelEntry(value: unknown): value is ModelEntry {
	return (
		isPlainRecord(value) &&
		hasOnlyKeys(value, ["model", "thinking"]) &&
		typeof value.model === "string" &&
		value.model.includes("/") &&
		value.model.search(UNSAFE_TERMINAL_CHARACTERS) === -1 &&
		isOneOf(thinkingLevels, value.thinking)
	);
}

function isProfile(value: unknown): value is Profile {
	return (
		isPlainRecord(value) &&
		Object.entries(value).every(
			([specialist, entry]) =>
				isOneOf(specialists, specialist) && isModelEntry(entry),
		)
	);
}

function isModelProfiles(value: unknown): value is ModelProfiles {
	return (
		isPlainRecord(value) &&
		hasOnlyKeys(value, ["schemaVersion", "active", "profiles"]) &&
		value.schemaVersion === 2 &&
		isPlainRecord(value.profiles) &&
		Object.entries(value.profiles).every(
			([name, profile]) => profileName.test(name) && isProfile(profile),
		) &&
		typeof value.active === "string" &&
		Object.hasOwn(value.profiles, value.active)
	);
}

function parseModelProfiles(text: string): ModelProfiles {
	const parsed: unknown = JSON.parse(text);
	if (isPlainRecord(parsed) && parsed.schemaVersion === 1) {
		throw new Error(
			"schema version 1 model lists are no longer supported; delete the file and recreate the profiles with /workflow:models",
		);
	}
	if (!isModelProfiles(parsed)) {
		throw new Error(
			"expected schemaVersion 2 with an active profile and profiles of explorer, worker, and verifier model/thinking entries",
		);
	}
	return parsed;
}

export type ModelProfilesLoad =
	| { status: "absent" }
	| { status: "loaded"; profiles: ModelProfiles }
	| { status: "refused"; reason: string };

function errorCode(error: unknown): unknown {
	return (error as { code?: unknown }).code;
}

function canonicalJson(value: unknown): string {
	return JSON.stringify(value, (_key, item) =>
		isPlainRecord(item)
			? Object.fromEntries(
					Object.entries(item).sort(([left], [right]) =>
						left < right ? -1 : left > right ? 1 : 0,
					),
				)
			: item,
	);
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

export function report(
	ctx: Pick<ExtensionCommandContext, "hasUI" | "ui">,
	message: string,
	level: "info" | "warning" | "error",
) {
	if (ctx.hasUI) ctx.ui.notify(message, level);
	else console.error(message);
}

export function createModelProfiles(agentDirectory: string) {
	const path = resolve(agentDirectory, "pi-workflow-models.json");

	function readText(): string | undefined {
		return entryExists(path) ? readFileSync(path, "utf8") : undefined;
	}

	function parseText(text: string | undefined): ModelProfilesLoad {
		if (text === undefined) return { status: "absent" };
		try {
			return { status: "loaded", profiles: parseModelProfiles(text) };
		} catch (error) {
			return {
				status: "refused",
				reason: `Invalid model profiles at ${path}: ${errorMessage(error)}`,
			};
		}
	}

	function readProfiles(): ModelProfilesLoad {
		try {
			return parseText(readText());
		} catch (error) {
			return {
				status: "refused",
				reason: `Unable to read ${path}: ${errorMessage(error)}`,
			};
		}
	}

	let snapshot = readProfiles();

	async function edit(ctx: CommandContext) {
		if (!held(profileOverlay)) {
			report(
				ctx,
				"Model profiles are not seated. Run /workflow:config.",
				"error",
			);
			return { status: "refused" };
		}
		if (!ctx.hasUI || ctx.mode !== "tui") {
			report(ctx, "The model profiles panel needs the TUI.", "error");
			return { status: "refused" };
		}
		let openedText: string | undefined;
		try {
			openedText = readText();
		} catch (error) {
			report(ctx, `Unable to read ${path}: ${errorMessage(error)}`, "error");
			return { status: "refused" };
		}
		const current = parseText(openedText);
		if (current.status === "refused") {
			report(ctx, current.reason, "error");
			return { status: "refused" };
		}
		const existed = current.status === "loaded";
		const state: EditableProfiles = existed
			? structuredClone({
					active: current.profiles.active,
					profiles: current.profiles.profiles,
				})
			: { active: "default", profiles: { default: {} } };
		const unchanged = canonicalJson(state);
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
				(tui, theme, keybindings, done) =>
					createModelProfilesEditor(
						state,
						catalog,
						supportedThinking,
						theme,
						keybindings,
						done,
						() => tui.terminal.rows,
					),
				{
					overlay: true,
					overlayOptions: {
						anchor: "center",
						width: "70%",
						minWidth: 44,
						maxHeight: "100%",
					},
				},
			);
			if (action === "save") break;
			if (
				canonicalJson(state) === unchanged ||
				(await ctx.ui.confirm(
					"Discard changes?",
					"The model profiles have unsaved changes.",
				))
			) {
				return { status: "cancelled" };
			}
		}
		const changedOnDisk = () => {
			report(
				ctx,
				`${path} changed on disk since the panel opened and was not replaced.`,
				"warning",
			);
			return { status: "kept" };
		};
		try {
			if (readText() !== openedText) return changedOnDisk();
		} catch {
			return changedOnDisk();
		}
		const saved: ModelProfiles = { schemaVersion: 2, ...state };
		try {
			writeJsonAtomically(path, saved, { replace: existed });
		} catch (error) {
			if (errorCode(error) !== "EEXIST") throw error;
			return changedOnDisk();
		}
		snapshot = { status: "loaded", profiles: saved };
		report(ctx, `Saved model profiles to ${path}.`, "info");
		return { status: "saved" };
	}

	return { load: () => snapshot, edit };
}
