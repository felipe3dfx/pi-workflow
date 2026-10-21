import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { KeybindingsManager, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
import { createAskParentTool, createChildQueryTools, createChildSessions } from "../../../extensions/child-sessions.ts";
import { createChildAudit } from "../../../extensions/child-audit.ts";
import { createAskUserQuestionTool } from "../../../extensions/ask-user-panel.ts";
import { createFooterHints } from "../../../extensions/chrome.ts";
import { capabilities } from "../../../extensions/configure.ts";
import { replaceSelection } from "../../../extensions/shell.ts";
import { fakeChildren } from "../../../test/support/fake-children.mjs";
import { eventually } from "../../../test/support/eventually.mjs";

replaceSelection({
	schemaVersion: 1,
	capabilities: Object.fromEntries(capabilities.map((name) => [name, true])),
	expectations: {},
});
initTheme("dark", false);

const target = "fixture://other-owner/draft";
const approval = `Approve scope expansion and destructive action: discard draft at ${target}.`;
const fact = "The assigned fixture is owned by this task; the proposed verification is in scope.";
const refusal = "Not authorized; stop the proposed action.";
const scenarios = [
	{ id: "parent-facts", mode: "facts", authorized: true },
	{ id: "unresolved-parent", mode: "consult", authorized: true },
	{ id: "destructive-out-of-scope", mode: "explicit", authorized: true },
	{ id: "dismissal", mode: "dismiss", authorized: false },
	{ id: "panel-abort", mode: "abort", authorized: false },
	{ id: "user-unavailable", mode: "no-ui", authorized: false },
	{ id: "cancelled-waiting", mode: "cancel", authorized: false },
	{ id: "delivery-failure", mode: "delivery-failure", authorized: false },
	{ id: "foreground-refusal", mode: "foreground", authorized: false },
	{ id: "reply-identity-guards", mode: "guards", authorized: true },
	{ id: "wrong-target-nonauthorization", mode: "wrong-target", authorized: false },
];

function operatorContext(mode, events, controller, counters) {
	const theme = { fg: (_name, text) => text, bg: (_name, text) => text, bold: (text) => text };
	return {
		hasUI: mode !== "no-ui",
		mode: mode === "no-ui" ? "print" : "tui",
		getContextUsage: () => undefined,
		ui: {
			custom(factory) {
				assert.notEqual(mode, "no-ui");
				counters.panels += 1;
				events.push("real-panel-instantiated");
				return new Promise((resolve) => {
					const panel = factory(
						{ terminal: { rows: 40 }, requestRender() {} },
						theme,
						new KeybindingsManager(TUI_KEYBINDINGS),
						resolve,
					);
					assert.ok(panel.render(100).length > 0);
					events.push(`simulated-operator:${mode}`);
					if (mode === "abort") controller.abort();
					else if (mode === "dismiss") {
						panel.handleInput("\x1b");
						panel.handleInput("X");
					} else {
						const answer = mode === "explicit" ? approval : mode === "wrong-target" ? approval.replace(target, "fixture://different-target") : fact;
						for (const char of answer) panel.handleInput(char);
						panel.handleInput("\r");
					}
				});
			},
		},
	};
}

async function exercise(scenario) {
	const events = [];
	const states = [];
	const counters = { executions: 0, consultations: 0, panels: 0 };
	const messages = [];
	let questionReady = Promise.withResolvers();
	let askError;
	let replyText;
	let sessions;
	let id;
	const runDone = Promise.withResolvers();
	const recordZero = (event) => {
		assert.equal(counters.executions, 0);
		events.push(`${event}:executions=0`);
	};
	const children = fakeChildren({
		async run(_task, spec) {
			const ask = createAskParentTool(spec.ask);
			try {
				for (let number = 1; number <= (scenario.mode === "guards" ? 2 : 1); number += 1) {
					recordZero(`ask-parent:${number}`);
					const result = await ask.execute(`ask-${number}`, {
						question: ["facts", "consult", "guards"].includes(scenario.mode)
							? "Resolve ownership of the assigned fixture before its proposed in-scope verification."
							: `Resolve authority before simulated action: discard draft at ${target}; scope expansion and destruction require explicit action-target approval.`, 
					});
					replyText = result.content[0].text;
					events.push(`resume:${number}`);
					assert.equal(sessions.get(id).state, "running");
				}
				const expected = ["explicit", "wrong-target"].includes(scenario.mode) ? approval : fact;
				if (replyText === expected && sessions.get(id).state === "running") {
					assert.equal(counters.executions, 0);
					counters.executions += 1;
					events.push("simulated-execute");
				} else events.push("scripted-nonauthorization");
			} catch (error) {
				askError = error.message;
				events.push("ask-rejected");
			}
			runDone.resolve();
			return "Scripted fixture finished; no actual action performed.";
		},
	});
	sessions = createChildSessions({
		create: children.create,
		send(message) {
			if (message.customType !== "pi-workflow-child-question") return;
			assert.equal(message.details.state, "waiting");
			recordZero(`question-message:${message.details.question}`);
			if (scenario.mode === "delivery-failure") throw new Error("scripted transport failure");
			messages.push(message);
			questionReady.resolve(message);
		},
		idle: () => false,
		trace(entry) {
			states.push(entry.state);
			events.push(`state:${entry.state}`);
		},
		report(message) { assert.fail(message); },
		schedule: () => () => {},
		audit: createChildAudit({ root: "", parent: () => undefined }),
	});
	const reply = createChildQueryTools(sessions).find((tool) => tool.name === "reply_child");
	const sendReply = async (message, answer) => {
		recordZero(`real-reply-child:${message.details.question}`);
		const result = await reply.execute("reply", { id: message.details.id, question: message.details.question, answer });
		assert.equal(result.details.id, id);
	};
	const plan = {
		role: "worker", contract: { prompt: "Scripted fixture", tools: [] },
		task: "Exercise isolated escalation", worktree: process.cwd(), model: "fixture/scripted",
		thinking: "medium", chosenBy: "parent", references: [],
	};
	try {
		const starting = sessions.start(plan, {
			background: scenario.mode !== "foreground", modelRegistry: {},
			project: () => ({ cwd: process.cwd(), trusted: false }), shell: () => ({}),
			onLaunch(childId) { id = childId; },
		});
		if (scenario.mode === "foreground") {
			await starting;
			await runDone.promise;
			assert.match(askError, /parent cannot answer.*foreground/i);
			assert.equal(messages.length, 0);
		} else {
			await starting;
			if (scenario.mode === "delivery-failure") {
				await runDone.promise;
				assert.match(askError, /question could not reach the parent: scripted transport failure/i);
				assert.equal(sessions.get(id).state, "running");
			} else {
				const message = await questionReady.promise;
				assert.equal(sessions.get(id).state, "waiting");
				recordZero("parent-received-emitted-question");
				if (scenario.mode === "cancel") {
					const cancel = createChildQueryTools(sessions).find((tool) => tool.name === "cancel_child");
					events.push("real-cancel-child");
					await cancel.execute("cancel", { id });
					await assert.rejects(reply.execute("late", { id, question: 1, answer: approval }), /cancelled/);
					await runDone.promise;
					assert.match(askError, /child was cancelled/i);
					assert.equal(sessions.get(id).state, "cancelled");
				} else if (scenario.mode === "guards") {
					await assert.rejects(reply.execute("wrong-id", { id: "missing", question: 1, answer: fact }), /No child/);
					await assert.rejects(reply.execute("wrong-number", { id, question: 2, answer: fact }), /not waiting/);
					assert.equal(sessions.get(id).state, "waiting");
					recordZero("wrong-id-and-number-rejected-still-waiting");
					questionReady = Promise.withResolvers();
					await sendReply(message, "Continue consultation; this is not action authorization.");
					const second = await questionReady.promise;
					await assert.rejects(reply.execute("duplicate", { id, question: 1, answer: fact }), /already answered/);
					assert.equal(sessions.get(id).state, "waiting");
					recordZero("duplicate-rejected-second-question-still-waiting");
					await sendReply(second, fact);
				} else if (scenario.mode === "facts") {
					events.push("scripted-parent-resolves-facts");
					await sendReply(message, fact);
				} else {
					counters.consultations += 1;
					recordZero("real-ask-user-question");
					const controller = new AbortController();
					const result = await createAskUserQuestionTool(createFooterHints()).execute(
						"consult", { question: message.details.text }, controller.signal, undefined,
						operatorContext(scenario.mode, events, controller, counters),
					);
					events.push(`operator-question-result:${result.details.status}`);
					const text = result.details.status === "answered" ? result.details.text : refusal;
					if (["dismiss", "abort", "no-ui"].includes(scenario.mode)) assert.equal(result.details.status, "refused");
					await sendReply(message, text);
				}
				await runDone.promise;
			}
			await eventually(() => sessions.get(id).state, (state) => ["completed", "cancelled"].includes(state));
		}
		const expectedStates = scenario.mode === "foreground" ? ["running", "completed"]
			: scenario.mode === "cancel" ? ["queued", "running", "waiting", "cancelled"]
			: scenario.mode === "guards" ? ["queued", "running", "waiting", "running", "waiting", "running", "completed"]
			: ["queued", "running", "waiting", "running", "completed"];
		assert.deepEqual(states, expectedStates);
		if (!["foreground", "cancel", "delivery-failure"].includes(scenario.mode)) assert.equal(askError, undefined);
		assert.equal(counters.executions, Number(scenario.authorized));
		const consults = ["consult", "explicit", "dismiss", "abort", "no-ui", "wrong-target"].includes(scenario.mode) ? 1 : 0;
		assert.equal(counters.consultations, consults);
		assert.equal(counters.panels, scenario.mode === "no-ui" ? 0 : consults);
		if (!["foreground", "cancel", "delivery-failure"].includes(scenario.mode)) {
			assert.ok(events.indexOf("ask-parent:1:executions=0") < events.indexOf("state:waiting"));
			assert.ok(events.indexOf("state:waiting") < events.indexOf("question-message:1:executions=0"));
			assert.ok(events.indexOf("real-reply-child:1:executions=0") < events.indexOf("resume:1"));
			if (scenario.authorized) assert.ok(events.lastIndexOf(`resume:${scenario.mode === "guards" ? 2 : 1}`) < events.indexOf("simulated-execute"));
			else assert.ok(events.indexOf("resume:1") < events.indexOf("scripted-nonauthorization"));
		}
		return { id: scenario.id, input: "declared scripted semantic fixture; no classifier/model evidence", authorized: scenario.authorized, counters, states, events, ...(askError ? { askError } : {}) };
	} finally {
		await sessions.disposeAll();
	}
}

test("isolated real escalation seams with scripted decisions and simulated operator/executor", { timeout: 20000 }, async (t) => {
	const observations = [];
	for (const scenario of scenarios) {
		await t.test(scenario.id, async () => { observations.push(await exercise(scenario)); });
	}
	assert.equal(observations.length, scenarios.length);
	const paths = [
		".agents/prototypes/action-escalation/README.md",
		".agents/prototypes/action-escalation/integration.test.mjs",
		"extensions/child-sessions.ts", "extensions/ask-user-panel.ts",
		"test/support/fake-children.mjs",
	];
	const sha256 = {};
	for (const path of paths) sha256[path] = createHash("sha256").update(await readFile(new URL(`../../../${path}`, import.meta.url))).digest("hex");
	await writeFile(new URL("evidence.json", import.meta.url), `${JSON.stringify({ schemaVersion: 1, command: "node --test .agents/prototypes/action-escalation/integration.test.mjs", sha256, observations }, null, 2)}\n`);
});
