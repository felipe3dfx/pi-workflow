import { createRequire } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";

import {
	CustomMessageComponent,
	initTheme,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";

import { registerChildResultCards } from "../extensions/child-result-card.ts";
import { capabilities, replaceSelection } from "../extensions/configure.ts";

replaceSelection({
	schemaVersion: 1,
	capabilities: Object.fromEntries(
		capabilities.map((capability) => [capability, capability === "child-session"]),
	),
	expectations: {},
});

const piTui = await import(
	createRequire(import.meta.resolve("@earendil-works/pi-coding-agent")).resolve(
		"@earendil-works/pi-tui",
	)
);
const markdownTheme = new Proxy({}, { get: () => (text) => text });
const id = "5636a1b2-0000-4000-8000-000000000000";
const details = {
	id,
	state: "completed",
	role: "worker",
	model: "openai/gpt-6-luna",
	thinking: "high",
	task: "Ejecuta sleep 60 para esperar 60 segundos",
	elapsedMs: 62_000,
	text: "He terminado; ejecuté `sleep 60` y esperé 60 segundos.",
};

function cards(t) {
	initTheme("dark", false);
	const { KeybindingsManager, setKeybindings, TUI_KEYBINDINGS } = piTui;
	setKeybindings(
		new KeybindingsManager({
			...TUI_KEYBINDINGS,
			"app.tools.expand": { defaultKeys: "ctrl+o" },
		}),
	);
	t.after(() => setKeybindings(new KeybindingsManager(TUI_KEYBINDINGS)));
	const renderers = new Map();
	const handlers = new Map();
	registerChildResultCards({
		registerMessageRenderer: (type, render) => renderers.set(type, render),
		on: (event, handler) => handlers.set(event, handler),
	});
	t.after(() => handlers.get("session_shutdown")());
	const card = (message) =>
		new CustomMessageComponent(
			{ role: "custom", display: true, content: "", ...message },
			renderers.get(message.customType),
			markdownTheme,
			1,
		);
	return { card, shutdown: () => handlers.get("session_shutdown")() };
}

const plain = (component, width = 90) =>
	component
		.render(width)
		.map((line) => stripVTControlCharacters(line).trimEnd());

test("a collapsed result is one row with the role, id, Verdict, elapsed time, and Pi's expand key", (t) => {
	const { card } = cards(t);
	assert.deepEqual(
		plain(card({ customType: "pi-workflow-child-result", details })),
		[
			"",
			"   ◆ Subagent worker 5636  1m 02s                                    (ctrl+o to expand)",
		],
	);
	const long = card({
		customType: "pi-workflow-child-result",
		details: {
			...details,
			verdict: "pass",
			text: "uno\n\ndos\n\ntres\n\ncuatro\n\ncinco",
		},
	});
	assert.deepEqual(plain(long).slice(1), [
		"   ◆ Subagent worker 5636 pass  1m 02s                               (ctrl+o to expand)",
	]);
});

test("a blocked or failed Verdict shows its reason on a second line without expanding", (t) => {
	const { card } = cards(t);
	for (const verdict of ["blocked", "fail"])
		assert.deepEqual(
			plain(
				card({
					customType: "pi-workflow-child-result",
					details: {
						...details,
						verdict,
						text: `Verdict: ${verdict}\n\nDatabase access is missing\n\nanother detail`,
					},
				}),
			).slice(1),
			[
				`   ◆ Subagent worker 5636 ${verdict}  1m 02s${" ".repeat(verdict === "fail" ? 31 : 28)}(ctrl+o to expand)`,
				"     Database access is missing",
			],
		);
});

test("a blocked worker shows the first left_undone item as its reason", (t) => {
	const { card } = cards(t);
	const blocked = (text) =>
		plain(
			card({
				customType: "pi-workflow-child-result",
				details: { ...details, verdict: "blocked", text },
			}),
		)[2];
	assert.equal(
		blocked(
			"## Summary\n\nCould not continue.\n\nstatus: blocked\nfiles_changed:\n- none\nvalidation:\n- none\nleft_undone:\n- Database access is missing\n- Another pending item",
		),
		"     Database access is missing",
	);
	assert.equal(
		blocked("status: blocked\nleft_undone:\n- The credential is missing"),
		"     The credential is missing",
	);
});

test("a failed or blocked verifier shows the line next to its verdict as its reason", (t) => {
	const { card } = cards(t);
	const verifier = (verdict, text) =>
		plain(
			card({
				customType: "pi-workflow-child-result",
				details: { ...details, role: "verify", verdict, text },
			}),
		)[2];
	assert.equal(
		verifier(
			"fail",
			"## Review\n\nRan npm test.\nThe migration fails on null ids.\nverdict: fail",
		),
		"     The migration fails on null ids.",
	);
	assert.equal(
		verifier("blocked", "Intro.\n\nverdict: blocked\nThere is no database access."),
		"     There is no database access.",
	);
});

test("ctrl+o shows the task, the whole result, and the subagents view key", (t) => {
	const { card } = cards(t);
	const component = card({
		customType: "pi-workflow-child-result",
		details: { ...details, text: "uno\n\ndos\n\ntres\n\ncuatro" },
	});
	component.setExpanded(true);
	assert.deepEqual(plain(component), [
		"",
		"   ◆ Subagent worker 5636  gpt-6-luna (high) · 1m 02s              (ctrl+o to collapse)",
		"     Task Ejecuta sleep 60 para esperar 60 segundos",
		"     uno",
		"",
		"     dos",
		"",
		"     tres",
		"",
		"     cuatro",
		"     alt+a  open in subagents view",
	]);
});

test("failures show their reason collapsed, and questions always show their whole text, in the error and warning tones", (t) => {
	const { card } = cards(t);
	const error = "line 1\n\nline 2\n\nline 3\n\nline 4";
	const failed = card({
		customType: "pi-workflow-child-result",
		details: { ...details, state: "timed out", text: error },
	});
	assert.deepEqual(plain(failed).slice(1), [
		"   ◆ Subagent worker 5636 timed out  1m 02s                          (ctrl+o to expand)",
		"     line 1",
	]);
	const asked = card({
		customType: "pi-workflow-child-question",
		details: {
			...details,
			state: "waiting",
			question: 2,
			text: "¿Debo tocar X?",
		},
	});
	assert.deepEqual(plain(asked).slice(1), [
		"   ◆ Subagent worker 5636 asks · question 2                          (ctrl+o to expand)",
		"     ¿Debo tocar X?",
	]);
	const theme = globalThis[Symbol.for("@earendil-works/pi-coding-agent:theme")];
	assert.ok(failed.render(90)[1].includes(theme.fg("error", "◆")));
	assert.ok(asked.render(90)[1].includes(theme.fg("warning", "◆")));
});

test("sessions saved before the richer details still render from the message content", (t) => {
	const { card } = cards(t);
	const old = (customType, content, state) =>
		plain(card({ customType, content, details: { id, state } }));
	assert.deepEqual(
		old(
			"pi-workflow-child-result",
			`Child ${id} completed:\n\nListo.`,
			"completed",
		),
		[
			"",
			"   ◆ Subagent 5636                                                   (ctrl+o to expand)",
		],
	);
	assert.deepEqual(
		old("pi-workflow-child-result", `Child ${id} failed: boom`, "failed").slice(
			1,
		),
		[
			"   ◆ Subagent 5636 failed                                            (ctrl+o to expand)",
			"     boom",
		],
	);
	assert.deepEqual(
		old(
			"pi-workflow-child-result",
			`Child ${id} cancelled.`,
			"cancelled",
		).slice(1),
		[
			"   ◆ Subagent 5636 cancelled                                         (ctrl+o to expand)",
		],
	);
	assert.deepEqual(
		old(
			"pi-workflow-child-question",
			`Child ${id} asks (question 3):\n\n¿Cuál?\n\nAnswer with reply_child with question 3.`,
			"waiting",
		).slice(1),
		[
			"   ◆ Subagent 5636 asks · question 3                                 (ctrl+o to expand)",
			"     ¿Cuál?",
		],
	);
});

test("a click toggles one card, the choice survives Pi's rebuild, and session shutdown forgets it", async (t) => {
	const { card, shutdown } = cards(t);
	const component = card({
		customType: "pi-workflow-child-result",
		details: { ...details, text: "a\n\nb\n\nc\n\nd" },
	});
	component.render(90);
	const result = component.handleMouse({
		type: "click",
		button: "left",
		x: 6,
		y: 1,
		width: 90,
		height: 7,
		screenX: 6,
		screenY: 1,
	});
	assert.ok(result?.handled);
	component.invalidate();
	assert.ok(plain(component).includes("     alt+a  open in subagents view"));
	const other = card({
		customType: "pi-workflow-child-result",
		details: { ...details, id: "9999aaaa" },
	});
	assert.ok(!plain(other).some((line) => line.includes("alt+a")));
	await shutdown();
	component.invalidate();
	assert.ok(!plain(component).some((line) => line.includes("alt+a")));
});

test("every card line fits the width it is given", (t) => {
	const { card } = cards(t);
	const component = card({
		customType: "pi-workflow-child-result",
		details: { ...details, text: `${"palabra ".repeat(40)}\n\n\tcon\ttab` },
	});
	for (const expanded of [false, true]) {
		component.setExpanded(expanded);
		for (let width = 8; width <= 160; width++)
			for (const line of component.render(width))
				assert.ok(visibleWidth(line) <= width, `width ${width}: ${line}`);
	}
});

test("results delivered together render one card per result, in delivery order", (t) => {
	const { card } = cards(t);
	const failed = {
		...details,
		id: "9999aaaa-0000-4000-8000-000000000000",
		state: "failed",
		text: "provider overloaded",
	};
	assert.deepEqual(
		plain(
			card({
				customType: "pi-workflow-child-result",
				details: { results: [details, failed] },
			}),
		),
		[
			"",
			"   ◆ Subagent worker 5636  1m 02s                                    (ctrl+o to expand)",
			"   ◆ Subagent worker 9999 failed  1m 02s                             (ctrl+o to expand)",
			"     provider overloaded",
		],
	);
});
