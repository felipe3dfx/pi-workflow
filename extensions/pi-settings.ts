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
	conflicts: string[];
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

function negate(item: unknown): string {
	const text = String(item);
	return text.startsWith("+") ? `-${text.slice(1)}` : `+${text.slice(1)}`;
}

function isNegatedIn(item: unknown, existing: unknown[]): boolean {
	return (
		typeof item === "string" &&
		/^[+-]./.test(item) &&
		existing.includes(negate(item))
	);
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
		conflicts: [],
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
	const misaligned: string[] = [];
	const conflicts: string[] = [];
	const merged: Record<string, unknown> = { ...current };
	let changed = false;
	for (const [key, expected] of Object.entries(catalog.settings)) {
		if (!Array.isArray(expected)) {
			if (!definitionsEqual(current[key], expected)) {
				misaligned.push(key);
				merged[key] = expected;
				changed = true;
			}
			continue;
		}
		const existing = Array.isArray(current[key]) ? current[key] : [];
		const missing = expected.filter(
			(item) => !existing.some((entry) => definitionsEqual(entry, item)),
		);
		if (missing.length === 0) continue;
		const blocking = missing.filter((item) => isNegatedIn(item, existing));
		if (blocking.length > 0) {
			conflicts.push(
				`${key}: ${blocking.map((item) => `${negate(item)} conflicts with ${item}`).join(", ")} (remove it manually)`,
			);
			continue;
		}
		misaligned.push(`${key}: missing ${missing.join(", ")}`);
		merged[key] = [...existing, ...missing];
		changed = true;
	}
	return { path, changed, misaligned, conflicts, merged };
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
