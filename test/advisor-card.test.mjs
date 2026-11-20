import test from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";

import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";

import { loadThemeFromPath } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import {
	patchMessages,
	restoreMessages,
} from "../extensions/chrome-messages.ts";
import { compactToolRenderers } from "../extensions/compact-tools.ts";
import { withAgentDirectory } from "./support/agent-directory.mjs";
import { parentSession, seat } from "./support/workflow-parent.mjs";

const piTui = await import(
	createRequire(import.meta.resolve("@earendil-works/pi-coding-agent")).resolve(
		"@earendil-works/pi-tui",
	)
);
const themeKey = Symbol.for("@earendil-works/pi-coding-agent:theme");
const cyan = "\x1b[38;2;125;207;255m";
const model = { model: "anthropic/claude-opus-5", thinking: "high" };
const advice = [
	"## Risks",
	"",
	"- The cache key ignores the locale.",
	"- The retry loop never backs off.",
	"",
	"Verify with a test per locale.",
].join("\n");

async function advisorCard(t) {
	const previous = globalThis[themeKey];
	globalThis[themeKey] = loadThemeFromPath(
		new URL("../themes/pi-workflow.json", import.meta.url).pathname,
		"truecolor",
	);
	piTui.setKeybindings(
		new piTui.KeybindingsManager({
			...piTui.TUI_KEYBINDINGS,
			"app.tools.expand": { defaultKeys: "ctrl+o" },
		}),
	);
	patchMessages();
	t.after(() => {
		restoreMessages();
		globalThis[themeKey] = previous;
		piTui.setKeybindings(new piTui.KeybindingsManager(piTui.TUI_KEYBINDINGS));
		seat();
	});
	seat();
	const dir = withAgentDirectory(t);
	await writeFile(
		join(dir, "pi-workflow-advisor.json"),
		JSON.stringify({ schemaVersion: 1, ...model }),
	);
	const tool = (await parentSession(dir)).tools.findLast(
		(entry) => entry.name === "advisor",
	);
	let calls = 0;
	return (steps = {}) => {
		const component = new ToolExecutionComponent(
			"advisor",
			`advisor-${++calls}`,
			{},
			{ showImages: false },
			compactToolRenderers("advisor", () => tool),
			{ requestRender() {} },
			"/",
		);
		component.markExecutionStarted();
		component.setArgsComplete();
		if (steps.partial !== undefined)
			component.updateResult(
				{ content: [], details: steps.partial, isError: false },
				true,
			);
		if (steps.final !== undefined)
			component.updateResult(
				{
					content: [{ type: "text", text: steps.final.text }],
					details: steps.final.details,
					isError: steps.final.isError ?? false,
					durationMs: steps.final.durationMs,
				},
				false,
			);
		return component;
	};
}

const theme = () => globalThis[themeKey];

const plain = (component, width = 100) =>
	component
		.render(width)
		.map((line) => stripVTControlCharacters(line).trimEnd());

test("a running consultation shows the cyan glyph, consulting…, and the model without its provider before any advice", async (t) => {
	const card = await advisorCard(t);
	assert.deepEqual(plain(card()), []);
	const running = card({ partial: model });
	assert.deepEqual(plain(running), [
		"",
		"   ◇ Advisor consulting…  claude-opus-5 (high)",
	]);
	assert.ok(running.render(100)[1].includes(`${cyan}◇`));
});

const done = (text, durationMs = 42_000) => ({
	partial: model,
	final: { text, details: model, durationMs },
});

function click(component) {
	component.render(100);
	return component.handleMouse({
		type: "click",
		button: "left",
		x: 5,
		y: 1,
		width: 100,
		height: 100,
		screenX: 5,
		screenY: 1,
	});
}

test("a finished consultation previews three lines and … N more lines, and Pi's expand key or a header click expands it", async (t) => {
	const card = await advisorCard(t);
	const finished = card(done(advice));
	const [blank, head, ...body] = plain(finished);
	assert.equal(blank, "");
	assert.match(
		head,
		/^ {3}◇ Advisor {2}42s · claude-opus-5 \(high\) +\(ctrl\+o to expand\)$/,
	);
	assert.deepEqual(body, [
		"     Risks",
		"",
		"     - The cache key ignores the locale.",
		"     … 3 more lines",
	]);
	assert.ok(finished.render(100)[1].includes(theme().fg("accent", "◇")));

	finished.setExpanded(true);
	const [, open, ...whole] = plain(finished);
	assert.match(open, /\(ctrl\+o to collapse\)$/);
	assert.deepEqual(whole, [
		"     Risks",
		"",
		"     - The cache key ignores the locale.",
		"     - The retry loop never backs off.",
		"",
		"     Verify with a test per locale.",
	]);

	const clicked = card(done(advice));
	assert.ok(click(clicked)?.handled);
	assert.equal(plain(clicked).length, 8);
	assert.ok(click(clicked)?.handled);
	assert.equal(plain(clicked).at(-1), "     … 3 more lines");
});

test("advice of four rendered lines or fewer shows whole with no expand hint, collapsed or expanded", async (t) => {
	const card = await advisorCard(t);
	const short = card(done("- one\n- two\n- three\n- four", 9_000));
	const expected = [
		"",
		"   ◇ Advisor  9s · claude-opus-5 (high)",
		"     - one",
		"     - two",
		"     - three",
		"     - four",
	];
	assert.deepEqual(plain(short), expected);
	short.setExpanded(true);
	assert.deepEqual(plain(short), expected);
	assert.deepEqual(
		plain(card(done("- one\n- two\n- three\n- four\n- five"))).at(-1),
		"     … 2 more lines",
	);
});

const failed = (failure, text, details = { ...model, failure }) => ({
	partial:
		details.model &&
		["overflow", "provider", "empty", "aborted"].includes(failure)
			? model
			: undefined,
	final: {
		text,
		details,
		isError: failure !== "refused",
		durationMs: 3_000,
	},
});

test("a failed consultation shows failed and its reason under the header in the error color", async (t) => {
	const card = await advisorCard(t);
	for (const [failure, text] of [
		[
			"unavailable",
			"The advisor model anthropic/claude-opus-5 is not available in Pi. Choose another with /workflow:advisor.",
		],
		[
			"thinking",
			"The advisor model anthropic/claude-opus-5 does not support thinking high. Choose another level with /workflow:advisor.",
		],
		[
			"overflow",
			"prompt is too long\nChoose a larger advisor model with /workflow:advisor.",
		],
		["provider", "401 invalid x-api-key"],
		["empty", "The advisor returned no advice."],
	]) {
		const shown = card(failed(failure, text));
		const lines = plain(shown, 140);
		assert.equal(lines[1], "   ◇ Advisor failed  3s · claude-opus-5 (high)");
		assert.deepEqual(
			lines.slice(2),
			text.split("\n").map((line) => `     ${line}`),
		);
		const raw = shown.render(140);
		assert.ok(raw[1].includes(theme().fg("error", "◇")), failure);
		assert.ok(raw[1].includes(theme().fg("error", "failed")), failure);
		assert.ok(raw[2].includes(theme().fg("error", text.split("\n")[0])));
	}
	assert.deepEqual(
		plain(
			card(
				failed(
					"no-model",
					"No advisor model is set. Choose one with /workflow:advisor.",
					{ failure: "no-model" },
				),
			),
		),
		[
			"",
			"   ◇ Advisor failed  3s",
			"     No advisor model is set. Choose one with /workflow:advisor.",
		],
	);
});

test("a stopped or refused consultation shows its word and its text dimmed", async (t) => {
	const card = await advisorCard(t);
	const stopped = card(
		failed("aborted", "Advisor consultation stopped by the operator."),
	);
	assert.deepEqual(plain(stopped), [
		"",
		"   ◇ Advisor stopped  3s · claude-opus-5 (high)",
		"     Advisor consultation stopped by the operator.",
	]);
	const refused = card(
		failed("refused", "Advisor is disabled. Enable it in /workflow:config."),
	);
	assert.deepEqual(plain(refused), [
		"",
		"   ◇ Advisor refused  3s · claude-opus-5 (high)",
		"     Advisor is disabled. Enable it in /workflow:config.",
	]);
	const [, stoppedHead, stoppedBody] = stopped.render(100);
	assert.ok(stoppedHead.includes(theme().fg("dim", "◇")));
	assert.ok(stoppedHead.includes(theme().fg("dim", "stopped")));
	assert.ok(
		stoppedBody.includes(
			theme().fg("dim", "Advisor consultation stopped by the operator."),
		),
	);
	const [, refusedHead, refusedBody] = refused.render(100);
	assert.ok(refusedHead.includes(theme().fg("dim", "◇")));
	assert.ok(refusedHead.includes(theme().fg("warning", "refused")));
	assert.ok(
		refusedBody.includes(
			theme().fg("dim", "Advisor is disabled. Enable it in /workflow:config."),
		),
	);
});

const longModel = {
	model:
		"openrouter/anthropic/claude-opus-5-20261101-preview-extended-context-1m",
	thinking: "xhigh",
};

test("narrow widths drop the hint first, then shorten the model id in the middle keeping its thinking, then truncate", async (t) => {
	const card = await advisorCard(t);
	assert.deepEqual(plain(card(done(advice)), 60).slice(1), [
		"   ◇ Advisor  42s · claude-opus-5 (high)",
		"     Risks",
		"",
		"     - The cache key ignores the locale.",
		"     … 3 more lines (ctrl+o to expand)",
	]);
	const long = (durationMs) =>
		card({
			partial: longModel,
			final: { text: "Sound.", details: longModel, durationMs },
		});
	assert.equal(
		plain(long(3_720_000), 140)[1],
		"   ◇ Advisor  1h 02m · anthropic/claude-opus-5-20261101-preview-extended-context-1m (xhigh)",
	);
	assert.equal(
		plain(long(3_720_000), 60)[1],
		"   ◇ Advisor  1h 02m · anthropic/cla…d-context-1m (xhigh)",
	);
	assert.equal(
		plain(long(1_000), 39)[1],
		"   ◇ Advisor  1s · anthr…t-1m (xh...",
	);
});

const hostile = {
	model: "fake/\u001b[31mred\u001b]0;title\u0007",
	thinking: "high\u001b[2J",
};
const hostileAdvice =
	"Run \u001b[2J now.\n\u001b]8;;https://example.com\u0007link\u001b]8;;\u0007\n\u0007bell";

const states = () => [
	{},
	{ partial: model },
	done(advice),
	{ ...done(advice), expanded: true },
	done("- one"),
	failed("provider", "401 invalid x-api-key"),
	failed("no-model", "No advisor model is set.", { failure: "no-model" }),
	failed("aborted", "Advisor consultation stopped by the operator."),
	failed("refused", "Advisor is disabled. Enable it in /workflow:config."),
	{ partial: longModel, final: { text: advice, details: longModel } },
	{ partial: hostile, final: { text: hostileAdvice, details: hostile } },
];

test("every card line fits its width, and hostile model, thinking, and advice cannot reach the terminal", async (t) => {
	const card = await advisorCard(t);
	const check = () => {
		for (const steps of states()) {
			const shown = card(steps);
			if (steps.expanded) shown.setExpanded(true);
			for (let width = 8; width <= 160; width++)
				for (const line of shown.render(width)) {
					assert.ok(visibleWidth(line) <= width, `${width}: ${line}`);
					for (const unsafe of [
						"\u001b[31m",
						"\u001b]0;",
						"\u0007",
						"\u001b[2J",
					])
						assert.ok(!line.includes(unsafe), JSON.stringify(line));
				}
		}
		const lines = plain(
			card({
				partial: hostile,
				final: { text: hostileAdvice, details: hostile },
			}),
			160,
		);
		assert.match(lines[1], /red.*\(high/);
		assert.ok(lines.some((line) => line.includes("Run")));
		assert.ok(lines.some((line) => line.includes("now.")));
	};
	check();
	seat([]);
	check();
});

test("with the advisor unseated a past card falls back to plain text without the ◇ glyph", async (t) => {
	const card = await advisorCard(t);
	const finished = card(done(advice));
	const broken = card(failed("provider", "401 invalid x-api-key"));
	seat(["child-session"]);
	assert.deepEqual(plain(finished), [
		"",
		"   Advisor  42s · claude-opus-5 (high)",
		"   ## Risks",
		"",
		"   - The cache key ignores the locale.",
		"   … 3 more lines",
	]);
	finished.setExpanded(true);
	assert.deepEqual(plain(finished), [
		"",
		"   Advisor  42s · claude-opus-5 (high)",
		...advice.split("\n").map((line) => (line ? `   ${line}` : "")),
	]);
	assert.deepEqual(plain(broken), [
		"",
		"   Advisor failed  3s · claude-opus-5 (high)",
		"   401 invalid x-api-key",
	]);

	seat(["advisor"]);
	assert.equal(
		plain(broken)[1],
		"   ◇ Advisor failed  3s · claude-opus-5 (high)",
	);
});
