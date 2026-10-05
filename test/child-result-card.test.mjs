import { createRequire } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";

import {
	CustomMessageComponent,
	initTheme,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";

import {
	answerCard,
	registerChildResultCards,
} from "../extensions/child-result-card.ts";
import { capabilities, replaceSelection } from "../extensions/configure.ts";

replaceSelection({
	schemaVersion: 1,
	capabilities: Object.fromEntries(
		capabilities.map((capability) => [
			capability,
			capability === "child-session",
		]),
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
	task: "Run sleep 60 to wait 60 seconds",
	elapsedMs: 62_000,
	text: "Done; I ran `sleep 60` and waited 60 seconds.",
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

const theme = () =>
	globalThis[Symbol.for("@earendil-works/pi-coding-agent:theme")];

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
			text: "one\n\ntwo\n\nthree\n\nfour\n\nfive",
		},
	});
	assert.deepEqual(plain(long).slice(1), [
		"   ◆ Subagent worker 5636 pass  1m 02s                               (ctrl+o to expand)",
	]);
});

test("a blocked, partial, or failed Verdict shows its reported reason on a second line without expanding", (t) => {
	const { card } = cards(t);
	for (const [role, verdict, gap] of [
		["worker", "blocked", 28],
		["worker", "partial", 28],
		["verify", "fail", 31],
	])
		assert.deepEqual(
			plain(
				card({
					customType: "pi-workflow-child-result",
					details: {
						...details,
						role,
						verdict,
						result: { verdict, reason: "Database access is missing" },
						text: `Summary first.\n\nleft_undone:\n- another detail\nverdict: ${verdict}`,
					},
				}),
			).slice(1),
			[
				`   ◆ Subagent ${role} 5636 ${verdict}  1m 02s${" ".repeat(gap)}(ctrl+o to expand)`,
				"     Database access is missing",
			],
		);
});

test("a done or passing Verdict shows no reason collapsed", (t) => {
	const { card } = cards(t);
	const done = card({
		customType: "pi-workflow-child-result",
		details: {
			...details,
			verdict: "done",
			result: { verdict: "done", reason: "All checks ran" },
		},
	});
	assert.equal(plain(done).length, 2);
});

test("a partial Verdict shows in the warning tone because the work is incomplete", (t) => {
	const { card } = cards(t);
	const partial = card({
		customType: "pi-workflow-child-result",
		details: {
			...details,
			verdict: "partial",
			result: { verdict: "partial", reason: "The migration is pending." },
		},
	});
	const theme = globalThis[Symbol.for("@earendil-works/pi-coding-agent:theme")];
	assert.ok(partial.render(90)[1].includes(theme.fg("warning", "partial")));
});

test("ctrl+o shows the task, the whole result, and the subagents view key", (t) => {
	const { card } = cards(t);
	const component = card({
		customType: "pi-workflow-child-result",
		details: { ...details, text: "one\n\ntwo\n\nthree\n\nfour" },
	});
	component.setExpanded(true);
	assert.deepEqual(plain(component), [
		"",
		"   ◆ Subagent worker 5636  gpt-6-luna (high) · 1m 02s              (ctrl+o to collapse)",
		"     Task Run sleep 60 to wait 60 seconds",
		"     one",
		"",
		"     two",
		"",
		"     three",
		"",
		"     four",
		"     alt+a  open in subagents view",
	]);
});

test("ctrl+o shows the reported reason and result fields between the task and the final text", (t) => {
	const { card } = cards(t);
	const worker = card({
		customType: "pi-workflow-child-result",
		details: {
			...details,
			verdict: "partial",
			result: {
				verdict: "partial",
				reason: "The migration is pending.",
				files_changed: ["src/a.ts: fixed the parser"],
				validation: ["npm test: 12 passed"],
				left_undone: [],
			},
			text: "one",
		},
	});
	worker.setExpanded(true);
	assert.deepEqual(plain(worker).slice(2, -1), [
		"     Task Run sleep 60 to wait 60 seconds",
		"     Reason: The migration is pending.",
		"     files_changed:",
		"     - src/a.ts: fixed the parser",
		"     validation:",
		"     - npm test: 12 passed",
		"     left_undone:",
		"     - none",
		"     one",
	]);
	const verifier = card({
		customType: "pi-workflow-child-result",
		details: {
			...details,
			role: "verify",
			verdict: "pass",
			result: {
				verdict: "pass",
				findings: ["The parser handles tabs."],
				unverified: ["Windows paths."],
			},
			text: "two",
		},
	});
	verifier.setExpanded(true);
	assert.deepEqual(plain(verifier).slice(3, -1), [
		"     findings:",
		"     - The parser handles tabs.",
		"     unverified:",
		"     - Windows paths.",
		"     two",
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
			text: "Should I touch X?",
		},
	});
	assert.deepEqual(plain(asked).slice(1), [
		"   ◆ Subagent worker 5636 asks · question 2                          (ctrl+o to expand)",
		"     Should I touch X?",
	]);
	const theme = globalThis[Symbol.for("@earendil-works/pi-coding-agent:theme")];
	assert.ok(failed.render(90)[1].includes(theme.fg("error", "◆")));
	assert.ok(asked.render(90)[1].includes(theme.fg("warning", "◆")));
});

test("without compatible details the card is not built and Pi shows the message content as is", (t) => {
	const { card } = cards(t);
	for (const message of [
		{
			customType: "pi-workflow-child-result",
			content: `Child ${id} failed: boom`,
			details: { id, state: "failed" },
		},
		{
			customType: "pi-workflow-child-question",
			content: `Child ${id} asks (question 3): which one?`,
		},
	]) {
		const lines = plain(card(message));
		assert.equal(
			lines.some((line) => line.includes("Subagent")),
			false,
		);
		assert.ok(lines.some((line) => line.includes(message.content)));
	}
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

test("the answer card is the question card's twin: Parent header with the question number, the whole answer, no role, no expand hint", (t) => {
	const { card } = cards(t);
	const answer = "line 1\n\nline 2\n\nline 3\n\nline 4";
	const component = answerCard({ id, question: 2, answer }, theme());
	const asked = card({
		customType: "pi-workflow-child-question",
		details: { ...details, state: "waiting", question: 2, text: answer },
	});
	assert.deepEqual(plain(component), [
		"   ◆ Parent → 5636 · answer 2",
		"     line 1",
		"",
		"     line 2",
		"",
		"     line 3",
		"",
		"     line 4",
	]);
	assert.equal(
		plain(component)[0].indexOf("◆"),
		plain(asked)[1].indexOf("◆"),
	);
	const answerLines = component.render(90);
	const askedLines = asked.render(90).slice(1);
	const labelStyle = (header) => header.match(/◆\S* (\S*?)[A-Z]/)[1];
	assert.equal(labelStyle(answerLines[0]), labelStyle(askedLines[0]));
	assert.deepEqual(answerLines.slice(1), askedLines.slice(1));
});

test("every answer card line fits the width it is given", (t) => {
	cards(t);
	const component = answerCard(
		{ id, question: 12, answer: `${"palabra ".repeat(40)}\n\n\tcon\ttab` },
		theme(),
	);
	for (let width = 8; width <= 160; width++)
		for (const line of component.render(width))
			assert.ok(visibleWidth(line) <= width, `width ${width}: ${line}`);
});
