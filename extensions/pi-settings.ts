import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
	activePiAgentDirectory,
	definitionsEqual,
	isPlainRecord,
	writeJsonAtomically,
} from "./mcp-config.ts";

export type PiSettingsCatalog = {
	schemaVersion: number;
	settings: Record<string, unknown>;
};

export interface PiSettingsAdapters {
	catalogPath?: string;
	agentDirectory?: string;
}

export type PiSettingsPlan = {
	path: string;
	changed: boolean;
	misaligned: string[];
	merged: Record<string, unknown>;
	error?: string;
};

const defaultSettingsCatalogPath = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../assets/settings.json",
);

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function loadPiSettingsCatalog(options: PiSettingsAdapters = {}): {
	catalog?: PiSettingsCatalog;
	error?: string;
} {
	const catalogPath = options.catalogPath ?? defaultSettingsCatalogPath;
	try {
		const parsed = JSON.parse(readFileSync(catalogPath, "utf8")) as {
			schemaVersion?: unknown;
			settings?: unknown;
		};
		if (parsed.schemaVersion !== 1) {
			return {
				error: `Settings catalog at ${catalogPath} must define schemaVersion 1.`,
			};
		}
		if (!isPlainRecord(parsed.settings)) {
			return {
				error: `Settings catalog at ${catalogPath} must define settings as an object.`,
			};
		}
		return { catalog: { schemaVersion: 1, settings: parsed.settings } };
	} catch (error) {
		return {
			error: `Unable to load settings catalog at ${catalogPath}: ${errorMessage(error)}`,
		};
	}
}

export function planPiSettings(
	catalog: PiSettingsCatalog,
	options: PiSettingsAdapters = {},
): PiSettingsPlan {
	const path = resolve(
		activePiAgentDirectory({ agentDirectory: options.agentDirectory }),
		"settings.json",
	);
	const refused = (reason: string): PiSettingsPlan => ({
		path,
		changed: false,
		misaligned: [],
		merged: {},
		error: `Refusing to overwrite malformed JSON at ${path}: ${reason}`,
	});
	let current: Record<string, unknown> = {};
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
		if (!isPlainRecord(parsed))
			return refused("top-level value must be an object.");
		current = parsed;
	} catch (error) {
		const code =
			typeof error === "object" && error !== null
				? (error as { code?: unknown }).code
				: undefined;
		if (code !== "ENOENT") return refused(errorMessage(error));
	}
	const misaligned = Object.keys(catalog.settings).filter(
		(key) => !definitionsEqual(current[key], catalog.settings[key]),
	);
	return {
		path,
		changed: misaligned.length > 0,
		misaligned,
		merged: { ...current, ...catalog.settings },
	};
}

export function applyPiSettings(
	catalog: PiSettingsCatalog,
	options: PiSettingsAdapters = {},
): { path: string; wrote: boolean; error?: string } {
	const plan = planPiSettings(catalog, options);
	if (plan.error) return { path: plan.path, wrote: false, error: plan.error };
	if (!plan.changed) return { path: plan.path, wrote: false };
	try {
		writeJsonAtomically(plan.path, plan.merged);
		return { path: plan.path, wrote: true };
	} catch (error) {
		return {
			path: plan.path,
			wrote: false,
			error: `Unable to write settings at ${plan.path}: ${errorMessage(error)}`,
		};
	}
}

export function manualPiSettingsInstructions(
	plan: PiSettingsPlan,
	catalog: PiSettingsCatalog,
): string {
	return [
		`Edit ${plan.path} manually and set these top-level keys:`,
		JSON.stringify(catalog.settings, null, 2),
		"Preserve unrelated keys, then restart Pi.",
	].join("\n");
}
