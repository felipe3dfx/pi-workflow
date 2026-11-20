import { chmodSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import {
	getSupportedThinkingLevels,
	type ModelThinkingLevel,
} from "@earendil-works/pi-ai";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { isPlainRecord, writeJsonAtomically } from "./agent-directory.ts";
import { createScreenFrame, modelCatalogScreen } from "./model-picker.ts";
import { report, thinkingLevels } from "./model-profiles.ts";
import { seated } from "./shell.ts";

type CommandContext = Pick<
	ExtensionCommandContext,
	"hasUI" | "mode" | "ui" | "modelRegistry"
>;

type AdvisorModel = { model: string; thinking: ModelThinkingLevel };

function isAdvisorModel(value: unknown): value is AdvisorModel {
	if (!isPlainRecord(value) || typeof value.model !== "string") return false;
	const slash = value.model.indexOf("/");
	return (
		slash > 0 &&
		slash < value.model.length - 1 &&
		(thinkingLevels as readonly unknown[]).includes(value.thinking)
	);
}

export function createAdvisor(agentDirectory: string) {
	const path = resolve(agentDirectory, "pi-workflow-advisor.json");

	function model(): AdvisorModel | undefined {
		try {
			const file: unknown = JSON.parse(readFileSync(path, "utf8"));
			if (
				isPlainRecord(file) &&
				file.schemaVersion === 1 &&
				isAdvisorModel(file)
			) {
				return { model: file.model, thinking: file.thinking };
			}
		} catch {}
		return undefined;
	}

	async function choose(ctx: CommandContext) {
		if (!seated("advisor", "overlay")) {
			report(
				ctx,
				"Advisor is disabled. Enable it in /workflow:config.",
				"warning",
			);
			return;
		}
		if (!ctx.hasUI || ctx.mode !== "tui") {
			report(ctx, "The advisor picker needs the TUI.", "warning");
			return;
		}
		const name = (entry: { provider: string; id: string }) =>
			`${entry.provider}/${entry.id}`;
		const catalog = ctx.modelRegistry.getAvailable().map(name);
		const supportedThinking = Object.fromEntries(
			ctx.modelRegistry
				.getAll()
				.map((entry) => [name(entry), getSupportedThinkingLevels(entry)]),
		);
		const chosen = await ctx.ui.custom<AdvisorModel | undefined>(
			(tui, theme, keybindings, done) => {
				const frame = createScreenFrame(
					theme,
					keybindings,
					() => tui.terminal.rows,
					() => done(undefined),
				);
				frame.push(
					modelCatalogScreen(
						frame,
						catalog,
						supportedThinking,
						"Advisor model",
						(model, thinking) => done({ model, thinking }),
						"close",
					),
				);
				return frame.component;
			},
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
		if (!chosen) return;
		writeJsonAtomically(path, { schemaVersion: 1, ...chosen });
		// writeJsonAtomically keeps an unreadable old file's mode; the choice must stay readable.
		chmodSync(path, (statSync(path).mode & 0o7777) | 0o400);
	}

	return { model, choose };
}
