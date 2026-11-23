import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { visibleWidth } from "@earendil-works/pi-tui";

import {
	runStateMark,
	taskStateMark,
	themeBgVar,
	themeVar,
} from "../extensions/visual-language.ts";
import { densityTerminal } from "./support/density-terminal.mjs";

const tagged = (sourcePath, mode) => ({
	sourcePath,
	getColorMode: () => mode,
	fg: (color, text) => `<${color}>${text}`,
});

async function withThemeFile(vars, run) {
	const dir = await mkdtemp(join(tmpdir(), "pi-workflow-theme-"));
	try {
		const path = join(dir, "theme.json");
		await writeFile(path, JSON.stringify({ vars }));
		return await run(path);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

test("a theme var follows var references to its hex and paints truecolor foreground and background", async () => {
	await withThemeFile(
		{ base: "#1abc9c", alias: "base", band: "#063806" },
		async (path) => {
			const source = tagged(path, "truecolor");
			assert.equal(
				themeVar("alias", "dim")("x", source),
				"\x1b[38;2;26;188;156mx\x1b[39m",
			);
			assert.equal(
				themeBgVar("band")("x", source),
				"\x1b[48;2;6;56;6mx\x1b[49m",
			);
		},
	);
});

test("a theme var falls back to its token, and a background var to no band, without truecolor, a source file or a hex", async () => {
	await withThemeFile(
		{ loop: "back", back: "loop", soft: "okhsl(20 99% 63%)", hex: "#ffffff" },
		async (path) => {
			for (const [source, name] of [
				[tagged(path, "256color"), "hex"],
				[tagged(undefined, "truecolor"), "hex"],
				[tagged(path, "truecolor"), "loop"],
				[tagged(path, "truecolor"), "soft"],
				[tagged(path, "truecolor"), "missing"],
			]) {
				assert.equal(themeVar(name, "dim")("x", source), "<dim>x", name);
				assert.equal(themeBgVar(name)("x", source), "x", name);
			}
		},
	);
});

test("below 60 terminal columns every state glyph of the shared scale is one column wide, and the Run and Task mappings share it", (t) => {
	densityTerminal(t, 44);
	const paint = (mark) => mark.paint(tagged(undefined, "truecolor"));
	const run = {
		queued: "<muted>○",
		running: "<accent>◐",
		waiting: "<warning>?",
		completed: "<success>✓",
		failed: "<error>✗",
		"timed out": "<error>✗",
		cancelled: "<muted>–",
		interrupted: "<warning>⊘",
	};
	const task = {
		pending: run.queued,
		"in progress": run.running,
		done: run.completed,
		blocked: "<warning>!",
	};
	for (const [state, expected] of Object.entries(run)) {
		assert.equal(paint(runStateMark(state)), expected, state);
		assert.equal(visibleWidth(runStateMark(state).glyph), 1, state);
	}
	for (const [state, expected] of Object.entries(task)) {
		assert.equal(paint(taskStateMark(state)), expected, state);
		assert.equal(visibleWidth(taskStateMark(state).glyph), 1, state);
	}
});

test("a new theme instance rereads its vars, while the same instance keeps the parsed ones", async () => {
	await withThemeFile({ tone: "#000001" }, async (path) => {
		const first = tagged(path, "truecolor");
		const paint = themeVar("tone", "dim");
		assert.match(paint("x", first), /38;2;0;0;1m/);
		await writeFile(path, JSON.stringify({ vars: { tone: "#000002" } }));
		assert.match(paint("x", first), /38;2;0;0;1m/);
		assert.match(paint("x", tagged(path, "truecolor")), /38;2;0;0;2m/);
	});
});
