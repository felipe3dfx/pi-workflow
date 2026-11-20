import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { stripVTControlCharacters } from "node:util";

import {
	CustomMessageComponent,
	ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";
import { Container, visibleWidth } from "@earendil-works/pi-tui";

import { loadThemeFromPath } from "../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import {
	answerCard,
	registerChildResultCards,
} from "../../extensions/child-result-card.ts";
import { patchChat, transcriptCursor } from "../../extensions/chrome-groups.ts";
import { assistantInset, edgeFor } from "../../extensions/chrome-messages.ts";
import {
	compactToolRenderers,
	hidden,
} from "../../extensions/compact-tools.ts";
import { capabilities } from "../../extensions/configure.ts";
import { replaceSelection } from "../../extensions/shell.ts";
import {
	type AdvisorDetails,
	advisorRenderers,
	seating,
	type Variant,
} from "./advisor-card.ts";
import * as fixtures from "./fixtures.ts";

const here = new URL(".", import.meta.url).pathname;
const widths = [60, 100, 140];
const themeKey = Symbol.for("@earendil-works/pi-coding-agent:theme");
(globalThis as Record<symbol, unknown>)[themeKey] = loadThemeFromPath(
	new URL("../../themes/pi-workflow.json", import.meta.url).pathname,
	"truecolor",
);

const piTui = await import(
	createRequire(import.meta.resolve("@earendil-works/pi-coding-agent")).resolve(
		"@earendil-works/pi-tui",
	)
);
const chalk = await import(
	createRequire(import.meta.resolve("@earendil-works/pi-coding-agent")).resolve(
		"chalk",
	)
);
chalk.default.level = 3;

piTui.setKeybindings(
	new piTui.KeybindingsManager({
		...piTui.TUI_KEYBINDINGS,
		"app.tools.expand": { defaultKeys: "ctrl+o" },
	}),
);

replaceSelection({
	schemaVersion: 1,
	capabilities: Object.fromEntries(capabilities.map((name) => [name, true])),
	expectations: {},
} as Parameters<typeof replaceSelection>[0]);

const ui = { requestRender() {} } as never;
const hollow: Variant = { glyph: "◇" };
const solid: Variant = { glyph: "◆" };
let calls = 0;

type Step = {
	partial?: { details?: AdvisorDetails };
	final?: {
		text: string;
		details?: AdvisorDetails;
		isError?: boolean;
		durationMs?: number;
	};
	expanded?: boolean;
};

function advisor(step: Step, variant = hollow) {
	const component = new ToolExecutionComponent(
		"advisor",
		`advisor-${++calls}`,
		{},
		{ showImages: false },
		compactToolRenderers("advisor", () => advisorRenderers(variant) as never),
		ui,
		"/",
	);
	component.markExecutionStarted();
	component.setArgsComplete();
	if (step.partial)
		component.updateResult(
			{ content: [], details: step.partial.details, isError: false },
			true,
		);
	if (step.final)
		component.updateResult(
			{
				content: [{ type: "text", text: step.final.text }],
				details: step.final.details,
				isError: step.final.isError ?? false,
				durationMs: step.final.durationMs,
			},
			false,
		);
	if (step.expanded) component.setExpanded(true);
	return component;
}

const model: AdvisorDetails = {
	model: "anthropic/claude-opus-5",
	thinking: "high",
};
const started = { partial: { details: model } };
const done = (text: string, durationMs = 42_000) => ({
	...started,
	final: { text, details: model, durationMs },
});
const failed = (failure: AdvisorDetails["failure"], text: string) => ({
	...started,
	final: {
		text,
		details: { ...model, failure },
		isError: failure !== "refused",
		durationMs: 3_000,
	},
});

const states: [string, () => { render(width: number): readonly string[] }][] =
	[
		["00 call issued, no update yet · renders nothing", () => advisor({})],
		["01 running · partial carries model and thinking", () => advisor(started)],
		["02 running · partial without details", () => advisor({ partial: {} })],
		["03 done · collapsed (long Markdown advice)", () => advisor(done(fixtures.advice))],
		[
			"04 done · expanded (ctrl+o or click)",
			() => advisor({ ...done(fixtures.advice), expanded: true }),
		],
		["05 done · short advice, nothing to expand", () => advisor(done(fixtures.short, 9_000))],
		[
			"05b done · short advice while every tool row is expanded",
			() => advisor({ ...done(fixtures.short, 9_000), expanded: true }),
		],
		["06 done · empty advice", () => advisor(done("", 7_000))],
		[
			"06b done · empty advice while every tool row is expanded",
			() => advisor({ ...done("", 7_000), expanded: true }),
		],
		[
			"07 done · collapsed cut inside a code fence",
			() => advisor(done(fixtures.fenced, 75_000)),
		],
		[
			"08 failed · model not available in Pi",
			() =>
				advisor(
					failed(
						"unavailable",
						"The advisor model anthropic/claude-opus-5 is not available in Pi. Choose another with /workflow:advisor.",
					),
				),
		],
		[
			"09 failed · thinking level not supported",
			() =>
				advisor(
					failed(
						"thinking",
						"The advisor model anthropic/claude-opus-5 does not support thinking high. Choose another level with /workflow:advisor.",
					),
				),
		],
		[
			"10 failed · provider or auth error",
			() =>
				advisor(
					failed(
						"provider",
						"anthropic: 401 authentication_error: invalid x-api-key. Run /login or check the provider key.",
					),
				),
		],
		[
			"11 failed · context larger than the advisor window",
			() =>
				advisor(
					failed(
						"overflow",
						"The parent context (312,480 tokens) exceeds the advisor model's window (200,000 tokens). Choose a larger advisor model with /workflow:advisor.",
					),
				),
		],
		[
			"12 stopped · operator abort (Esc)",
			() =>
				advisor(failed("aborted", "Advisor consultation stopped by the operator.")),
		],
		[
			"13 refused · capability unseated mid-turn (race only)",
			() =>
				advisor(
					failed("refused", "Advisor is disabled. Enable it in /workflow:config."),
				),
		],
		[
			"14 refused · model cleared mid-turn (race only)",
			() =>
				advisor({
					partial: {},
					final: {
						text: "No advisor model is set. Choose one with /workflow:advisor.",
						details: { failure: "refused" },
						durationMs: 0,
					},
				}),
		],
		[
			"15 done · long model id (middle ellipsis keeps thinking)",
			() =>
				advisor({
					partial: { details: fixtures.longModel },
					final: { text: fixtures.short, details: fixtures.longModel, durationMs: 3_725_000 },
				}),
		],
		[
			"16 failed · long model id",
			() =>
				advisor({
					partial: { details: fixtures.longModel },
					final: {
						text: "openrouter: 503 upstream overloaded.",
						details: { ...fixtures.longModel, failure: "provider" },
						isError: true,
						durationMs: 61_000,
					},
				}),
		],
		[
			"17 done · hostile model id and advice escapes",
			() =>
				advisor({
					partial: { details: fixtures.hostileModel },
					final: {
						text: fixtures.hostileAdvice,
						details: fixtures.hostileModel,
						durationMs: 1_000,
					},
				}),
		],
		[
			"18 failed · thrown error, details lost (model kept from the partial)",
			() =>
				advisor({
					...started,
					final: { text: "fetch failed: ECONNRESET", isError: true, durationMs: 12_000 },
				}),
		],
		[
			"19 done · no partial and no details",
			() => advisor({ final: { text: fixtures.short, durationMs: 5_000 } }),
		],
	];

function unseated(name: string, expanded: boolean) {
	return [
		name,
		() => {
			const component = advisor({ ...done(fixtures.advice), expanded });
			return {
				render(width: number) {
					seating.advisor = false;
					try {
						return component.render(width);
					} finally {
						seating.advisor = true;
					}
				},
			};
		},
	] as const;
}

states.push(
	unseated("20 fallback · advisor capability unseated, collapsed", false),
	unseated("21 fallback · advisor capability unseated, expanded", true),
);

function clicked() {
	const component = advisor(done(fixtures.advice));
	const before = component.render(100);
	const result = component.handleMouse({
		type: "click",
		button: "left",
		x: 4,
		y: 1,
		width: 100,
		height: before.length,
		screenX: 4,
		screenY: 1,
		shift: false,
		alt: false,
		ctrl: false,
	} as never);
	assert.ok(result, "a click on the head is handled");
	assert.equal((component as unknown as { expanded: boolean }).expanded, true);
	return component;
}

states.push(["22 done · after a left click on the head (Pi MouseRegion toggles this row)", clicked]);

function family(variant: Variant, cursor: "none" | "point" | "toggle") {
	const renderers = new Map<string, unknown>();
	registerChildResultCards({
		registerMessageRenderer: (type: string, render: unknown) =>
			renderers.set(type, render),
		on: () => {},
	} as never);
	const chat = new Container();
	chat.addChild(
		new CustomMessageComponent(
			{
				role: "custom",
				display: true,
				content: "",
				customType: "pi-workflow-child-question",
				details: fixtures.childQuestion,
			} as never,
			renderers.get("pi-workflow-child-question") as never,
			new Proxy({}, { get: () => (text: string) => text }) as never,
			1,
		),
	);
	const reply = new ToolExecutionComponent(
		"reply_child",
		"reply-1",
		fixtures.reply,
		{ showImages: false },
		{
			renderShell: "self",
			renderCall: () => hidden,
			renderResult: (_result: unknown, _options: unknown, theme: never, context: { args: never; lastComponent: unknown }) =>
				answerCard(context.args, theme, context.lastComponent),
		} as never,
		ui,
		"/",
	);
	reply.updateResult({ content: [{ type: "text", text: "Reply sent." }], isError: false }, false);
	chat.addChild(reply);
	chat.addChild(
		new CustomMessageComponent(
			{
				role: "custom",
				display: true,
				content: "",
				customType: "pi-workflow-child-result",
				details: fixtures.childResult,
			} as never,
			renderers.get("pi-workflow-child-result") as never,
			new Proxy({}, { get: () => (text: string) => text }) as never,
			1,
		),
	);
	const card = advisor(done(fixtures.advice), variant);
	chat.addChild(card);
	const next = new ToolExecutionComponent(
		"codegraph",
		"after-1",
		{ operation: "query", query: "pointAt" },
		{ showImages: false },
		compactToolRenderers("codegraph", () => undefined),
		ui,
		"/",
	);
	next.updateResult({ content: [{ type: "text", text: "pointAt chrome-groups.ts:507" }], isError: false }, false);
	chat.addChild(next);
	patchChat(chat, (width) => edgeFor(assistantInset, width));
	return {
		render(width: number) {
			card.setExpanded(false);
			chat.render(width);
			if (cursor !== "none") {
				transcriptCursor.leave();
				transcriptCursor.move(-1);
				transcriptCursor.move(-1);
			}
			if (cursor === "toggle") {
				assert.ok(transcriptCursor.toggle(), "cursor toggles the advisor row");
				assert.equal((card as unknown as { expanded: boolean }).expanded, true);
			}
			const lines = chat.render(width);
			if (cursor !== "none") transcriptCursor.leave();
			return lines;
		},
	};
}

states.push(
	["23 family · question, Parent answer, Subagent result, Advisor (◇ hollow), next tool row", () => family(hollow, "none")],
	["24 family · same with the solid ◆ variant", () => family(solid, "none")],
	["25 cursor · transcript cursor on the Advisor head (◇): pointAt finds no glyph", () => family(hollow, "point")],
	["26 cursor · transcript cursor on the Advisor head (◆): ▸ replaces the glyph", () => family(solid, "point")],
	["27 cursor · cursor toggle (Enter) on the Advisor head expands that row only", () => family(hollow, "toggle")],
);

function running_click() {
	const component = advisor(started);
	component.render(100);
	component.handleMouse({ type: "click", button: "left", x: 4, y: 1, width: 100, height: 1, screenX: 4, screenY: 1, shift: false, alt: false, ctrl: false } as never);
	assert.equal((component as unknown as { expanded: boolean }).expanded, true, "a running row is clickable");
	return component;
}

states.push(["28 running · after a click (Pi flips expanded; nothing visible changes)", running_click]);

for (const [name, build] of states) {
	const component = build();
	for (let width = 8; width <= 160; width++)
		for (const line of component.render(width))
			assert.ok(visibleWidth(line) <= width, `${name} @${width}: ${line}`);
	if (/^(0[1-9]|1)/.test(name)) {
		const heads = component
			.render(100)
			.filter((line) => /[◇◆] /.test(stripVTControlCharacters(line)));
		assert.equal(heads.length, 1, `${name}: one header`);
	}
}

const cursorLine = (name: string) =>
	states
		.find(([state]) => state.startsWith(name))?.[1]()
		.render(100)
		.find((line) => line.includes("Advisor"));
assert.notEqual(cursorLine("25"), cursorLine("23"), "the cursor marks the advisor row");
assert.equal(stripVTControlCharacters(cursorLine("25") ?? "").trimEnd(), stripVTControlCharacters(cursorLine("23") ?? "").trimEnd());
assert.equal(advisor({}).render(100).length, 0, "no row before the first update");

let plain = "";
let ansi = "";
for (const [name, build] of states) {
	for (const width of widths) {
		const lines = [...build().render(width)];
		const ruler = `${"─".repeat(width)}`;
		const title = `### ${name} · width ${width}`;
		plain += `${title}\n${ruler}\n${lines.map((line) => stripVTControlCharacters(line).trimEnd()).join("\n")}\n${ruler}\n\n`;
		ansi += `${title}\n${ruler}\n${lines.join("\n")}\n${ruler}\n\n`;
	}
}
writeFileSync(`${here}snapshots.txt`, plain);
writeFileSync(`${here}snapshots.ansi.txt`, ansi);
console.log(`${states.length} states × ${widths.length} widths → snapshots.txt, snapshots.ansi.txt`);
