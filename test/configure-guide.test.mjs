import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { initTheme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";

import { readSelection } from "../extensions/configure.ts";
import piWorkflowExtension from "../extensions/pi-workflow.ts";
import {
	body,
	catalogOf,
	click,
	closeSpan,
	driveConfig,
	focusOn,
	keys,
	lineIndex,
	plain,
	press,
	rowOf,
	taggedTheme,
	title,
	wheel,
} from "./support/config-guide.mjs";
import { withAgentDirectory } from "./support/jev-routing.mjs";

initTheme("dark", false);

const companions = JSON.parse(
	readFileSync(new URL("../assets/companions.json", import.meta.url), "utf8"),
).companions;
const [engram, nan, web, bridge] = companions.map((entry) => entry.package);

function guide(
	t,
	{ states, expectedOff = [], capabilitiesOff = [], exec } = {},
) {
	const dir = withAgentDirectory(t);
	const commands = new Map();
	piWorkflowExtension(
		{
			on() {},
			exec: exec ?? (async () => ({ code: 0 })),
			registerCommand: (name, command) => commands.set(name, command),
			registerTool() {},
			registerShortcut() {},
			registerMessageRenderer() {},
			registerToolRenderer() {},
			registerProvider() {},
			sendMessage() {},
		},
		{ agentDirectory: dir, catalog: catalogOf(states) },
	);
	const stored = readSelection(
		undefined,
		companions.map((entry) => entry.package),
	).selection;
	for (const name of expectedOff) stored.expectations[name] = false;
	for (const name of capabilitiesOff) stored.capabilities[name] = false;
	return {
		dir,
		command: commands.get("workflow:config"),
		write: () =>
			writeFile(
				join(dir, "pi-workflow-selection.json"),
				JSON.stringify(stored),
			),
	};
}

async function open(t, options, drive, driveOptions) {
	const setup = guide(t, options);
	if (options?.expectedOff || options?.capabilitiesOff) await setup.write();
	const session = await driveConfig(setup.command, drive, driveOptions);
	return { ...setup, session };
}

const storedSelection = async (dir) => {
	try {
		return JSON.parse(
			await readFile(join(dir, "pi-workflow-selection.json"), "utf8"),
		);
	} catch (error) {
		if (error.code === "ENOENT") return undefined;
		throw error;
	}
};

const assertNothingWritten = (dir) =>
	assert.rejects(readFile(join(dir, "pi-workflow-selection.json")), {
		code: "ENOENT",
	});

const openReview = (panel) => press(panel, keys.tab, keys.enter);
const closeGuide = (panel) => press(panel, keys.escape, keys.escape);

test("the guide opens on the defaults with nothing pending and the focus on Child session", async (t) => {
	let lines;
	let head;
	await open(t, {}, (panel) => {
		head = title(panel);
		lines = body(panel);
		closeGuide(panel);
	});
	assert.equal(head, "Workflow config");
	assert.ok(lines.includes("▸ [x] Child session"));
	for (const label of [
		"Todo",
		"Operator questions",
		"Model profiles",
		"CodeGraph",
		"Compact rendering",
	]) {
		assert.ok(lines.includes(`[x] ${label}`), label);
	}
	assert.ok(lines.some((line) => /^\[ \] Jev routing$/.test(line)));
	for (const name of [engram, nan, web, bridge]) {
		assert.ok(
			lines.some((line) => line.startsWith(`[x] ${name}`)),
			name,
		);
	}
	assert.ok(lines.every((line) => !line.includes("•")));
	assert.ok(
		lines.some((line) => /^Review and apply\s+no changes ›$/.test(line)),
	);
});

test("three titled sections list every label in order and the action closes the list", async (t) => {
	let lines;
	await open(t, {}, (panel) => {
		lines = body(panel).filter((line) => line !== "");
		closeGuide(panel);
	});
	const at = (text) => lines.findIndex((line) => line.startsWith(text));
	const order = [
		"Capabilities",
		"▸ [x] Child session",
		"[x] Todo",
		"[x] Operator questions",
		"[x] Model profiles",
		"[x] CodeGraph",
		"[x] Compact rendering",
		"Routing and delegation",
		"[ ] Jev routing",
		"Delegation mode",
		"Companions",
		`[x] ${engram}`,
		`[x] ${nan}`,
		`[x] ${web}`,
		`[x] ${bridge}`,
		"Review and apply",
	].map(at);
	assert.ok(
		order.every((index) => index >= 0),
		String(order),
	);
	assert.deepEqual(
		[...order].sort((a, b) => a - b),
		order,
	);
});

test("toggles show [x]/[ ], the choice shows ‹ value ›, the action ends with ›, and the focused row is marked and painted", async (t) => {
	let lines;
	let raw;
	await open(
		t,
		{ capabilitiesOff: ["todo"] },
		(panel) => {
			lines = body(panel);
			raw = panel.render(80);
			closeGuide(panel);
		},
		{ theme: taggedTheme },
	);
	assert.ok(lines.includes("[ ] Todo"));
	assert.ok(
		lines.some((line) =>
			/^Delegation mode\s+‹ opportunistic ›$/.test(
				line.replace(/\{selectedBg:|\}/g, ""),
			),
		),
	);
	assert.ok(
		lines.some((line) => /^Review and apply\s+no changes ›$/.test(line)),
	);
	const focused = raw.filter((line) => line.includes("{selectedBg:"));
	assert.equal(focused.length, 1);
	assert.match(focused[0], /▸ \[x\] Child session/);
});

test("Space and Enter flip a toggle, and the row ends with • only while it differs from the opened value", async (t) => {
	let seen;
	await open(t, {}, (panel) => {
		seen = [];
		const snap = () => seen.push(rowOf(panel, "Child session"));
		press(panel, keys.space);
		snap();
		press(panel, keys.enter);
		snap();
		press(panel, keys.enter);
		snap();
		closeGuide(panel);
		closeGuide(panel);
	});
	assert.match(seen[0], /^▸ \[ \] Child session\s+•$/);
	assert.match(seen[1], /^▸ \[x\] Child session$/);
	assert.match(seen[2], /^▸ \[ \] Child session\s+•$/);
});

test("←, → and Space move through the choice values, Enter advances, and the marker follows the opened value", async (t) => {
	let seen;
	await open(t, {}, (panel) => {
		seen = [];
		focusOn(panel, "Delegation mode");
		const snap = () => seen.push(rowOf(panel, "Delegation mode"));
		press(panel, keys.right);
		snap();
		press(panel, keys.left);
		snap();
		press(panel, keys.space);
		snap();
		press(panel, keys.enter);
		snap();
		press(panel, keys.left);
		snap();
		closeGuide(panel);
		closeGuide(panel);
	});
	assert.match(seen[0], /^▸\s+Delegation mode\s+‹ orchestrator ›\s+•$/);
	assert.match(seen[1], /^▸\s+Delegation mode\s+‹ opportunistic ›$/);
	assert.match(seen[2], /‹ orchestrator ›\s+•$/);
	assert.match(seen[3], /‹ opportunistic ›$/);
	assert.match(seen[4], /‹ orchestrator ›\s+•$/);
});

test("the title and the action show the pending summary, the install count, or neither", async (t) => {
	const snapshots = {};
	await open(t, {}, (panel) => {
		snapshots.none = [title(panel), rowOf(panel, "Review and apply")];
		press(panel, keys.space);
		snapshots.one = [title(panel), rowOf(panel, "Review and apply")];
		press(panel, keys.down, keys.space);
		snapshots.two = [title(panel), rowOf(panel, "Review and apply")];
		closeGuide(panel);
		closeGuide(panel);
	});
	assert.deepEqual(snapshots.none, ["Workflow config", snapshots.none[1]]);
	assert.match(snapshots.none[1], /no changes ›$/);
	assert.equal(snapshots.one[0], "Workflow config · 1 change");
	assert.match(snapshots.one[1], /1 change ›$/);
	assert.equal(snapshots.two[0], "Workflow config · 2 changes");
	assert.match(snapshots.two[1], /2 changes ›$/);
});

test("a missing expected companion shows installs only, and installs add to the count of changes", async (t) => {
	const snapshots = {};
	await open(t, { states: { [web]: "missing" } }, (panel) => {
		snapshots.installs = [title(panel), rowOf(panel, "Review and apply")];
		press(panel, keys.space);
		snapshots.both = [title(panel), rowOf(panel, "Review and apply")];
		closeGuide(panel);
		closeGuide(panel);
	});
	assert.equal(
		snapshots.installs[0],
		"Workflow config · no changes · 1 to install",
	);
	assert.match(snapshots.installs[1], /no changes · 1 to install ›$/);
	assert.equal(snapshots.both[0], "Workflow config · 1 change · 1 to install");
	assert.match(snapshots.both[1], /1 change · 1 to install ›$/);
});

test("the title falls back to the summary alone when the full title does not fit the frame", async (t) => {
	let head;
	let top;
	await open(t, { states: { [web]: "missing" } }, (panel) => {
		press(panel, keys.space, keys.down, keys.space);
		head = title(panel, 40);
		top = plain(panel, 40)[0];
		closeGuide(panel);
		closeGuide(panel);
	});
	assert.equal(head, "2 changes · 1 to install");
	assert.ok(!top.includes("Workflow config"));
});

test("each companion row shows installed, installed · kept, will install, or not installed", async (t) => {
	let lines;
	await open(
		t,
		{
			states: { [web]: "missing", [bridge]: "missing" },
			expectedOff: [nan, bridge],
		},
		(panel) => {
			lines = body(panel);
			closeGuide(panel);
		},
	);
	const state = (name) => lines.find((line) => line.includes(name));
	assert.match(state(engram), /^\[x\] .+\s+installed$/);
	assert.match(state(nan), /^\[ \] .+\s+installed · kept$/);
	assert.match(state(web), /^\[x\] .+\s+will install$/);
	assert.match(state(bridge), /^\[ \] .+\s+not installed$/);
});

test("an unreadable companion shows unreadable whether it is expected or not", async (t) => {
	let lines;
	await open(
		t,
		{ states: { [engram]: "error", [bridge]: "error" }, expectedOff: [bridge] },
		(panel) => {
			lines = body(panel);
			closeGuide(panel);
		},
	);
	assert.match(
		lines.find((line) => line.includes(engram)),
		/^\[x\] .+\s+unreadable$/,
	);
	assert.match(
		lines.find((line) => line.includes(bridge)),
		/^\[ \] .+\s+unreadable$/,
	);
});

test("the focused row's description shows below the list, a companion's from the real catalog", async (t) => {
	const copy = {};
	await open(t, {}, (panel) => {
		const descriptionOf = () => body(panel).join(" ").replace(/\s+/g, " ");
		copy.child = descriptionOf();
		focusOn(panel, "Todo");
		copy.todo = descriptionOf();
		for (const [key, label] of [
			["questions", "Operator questions"],
			["profiles", "Model profiles"],
			["codegraph", "CodeGraph"],
			["compact", "Compact rendering"],
		]) {
			focusOn(panel, label);
			copy[key] = descriptionOf();
		}
		focusOn(panel, "Jev routing");
		copy.jev = descriptionOf();
		focusOn(panel, "Delegation mode");
		copy.mode = descriptionOf();
		for (const entry of companions) {
			focusOn(panel, entry.package);
			copy[entry.package] = descriptionOf();
		}
		press(panel, keys.tab);
		copy.action = descriptionOf();
		closeGuide(panel);
	});
	assert.match(
		copy.child,
		/Delegate bounded work to child sessions; shows them above the input and offers spawn_child\./,
	);
	assert.match(copy.todo, /Session task list pinned above the input\./);
	assert.match(
		copy.questions,
		/Lets the agent ask you choices or open questions in a panel\./,
	);
	assert.match(copy.profiles, /Pick a model per role with \/workflow:models\./);
	assert.match(
		copy.codegraph,
		/Offers the codegraph tool for structural code search\./,
	);
	assert.match(
		copy.compact,
		/Shows Pi's built-in tool calls in compact form\. Off restores native rendering\./,
	);
	assert.match(
		copy.jev,
		/Ask Jev on each message whether the work stays in the parent or goes to a child session\. Needs a TypeSafe key\./,
	);
	assert.match(
		copy.mode,
		/opportunistic: the parent decides per message whether to delegate \(default\)\./,
	);
	assert.match(
		copy.mode,
		/orchestrator: the parent is told to delegate all work to child sessions and keep to conversing, planning, asking, and directing children\./,
	);
	for (const entry of companions) {
		assert.ok(
			copy[entry.package].includes(
				`${entry.description} Off stops expecting it; it is never uninstalled.`,
			),
			entry.package,
		);
	}
	assert.match(
		copy.action,
		/Opens a summary of every change\. Nothing is applied until you confirm there\./,
	);
});

test("choosing orchestrator with Child session off warns, and with it on does not", async (t) => {
	const warning =
		"No effect while Child session is off: the parent has no child tools to delegate with.";
	const joined = (panel) => body(panel).join(" ").replace(/\s+/g, " ");
	let off;
	let on;
	await open(t, {}, (panel) => {
		focusOn(panel, "Delegation mode");
		press(panel, keys.right);
		on = joined(panel);
		focusOn(panel, "Child session");
		press(panel, keys.space);
		focusOn(panel, "Delegation mode");
		off = joined(panel);
		closeGuide(panel);
		closeGuide(panel);
	});
	assert.ok(off.includes(warning));
	assert.ok(!on.includes(warning));
});

test("Tab moves the focus to Review and apply from any row", async (t) => {
	let focused;
	await open(t, {}, (panel) => {
		focusOn(panel, "Jev routing");
		press(panel, keys.tab);
		focused = body(panel).find((line) => line.startsWith("▸"));
		closeGuide(panel);
	});
	assert.match(focused, /^▸ Review and apply\s+no changes ›$/);
});

test("the hints follow the focused control and the pending changes", async (t) => {
	const hints = {};
	const last = (panel) =>
		body(panel)
			.filter((line) => line !== "")
			.at(-1);
	await open(t, {}, (panel) => {
		const all = () => body(panel).join(" ").replace(/\s+/g, " ");
		hints.toggle = all();
		focusOn(panel, "Delegation mode");
		hints.choice = all();
		press(panel, keys.tab);
		hints.action = all();
		hints.lastLine = last(panel);
		press(panel, keys.up, keys.up, keys.up, keys.space);
		hints.pending = all();
		closeGuide(panel);
		closeGuide(panel);
	});
	assert.ok(hints.toggle.includes("Space toggle"));
	assert.ok(hints.toggle.includes("↑/↓ move"));
	assert.ok(hints.toggle.includes("Tab go to apply"));
	assert.ok(hints.toggle.includes("Esc close"));
	assert.ok(hints.choice.includes("←/→/Space change"));
	assert.ok(hints.action.includes("Enter review"));
	assert.ok(hints.pending.includes("Esc discard changes"));
});

test("every rendered line stays within the width in the list", async (t) => {
	const widths = [30, 40, 56, 80, 120];
	const lengths = [];
	let rows;
	await open(t, { states: { [web]: "missing" } }, (panel) => {
		press(panel, keys.space);
		for (const width of widths) {
			for (const line of panel.render(width)) {
				lengths.push([width, visibleWidth(line)]);
			}
		}
		rows = body(panel, 56);
		closeGuide(panel);
		closeGuide(panel);
	});
	assert.ok(lengths.length > 0);
	assert.ok(lengths.every(([width, length]) => length <= width));
	assert.ok(rows.some((line) => /^▸ \[ \] Child session/.test(line)));
	assert.ok(rows.some((line) => /^\[x\] Todo/.test(line)));
	assert.ok(
		rows.some((line) => /^Delegation mode\s+‹ opportunistic ›/.test(line)),
	);
});

test("Tab then Enter opens the review with the changes as from → to", async (t) => {
	let head;
	let lines;
	await open(t, {}, (panel) => {
		press(panel, keys.space);
		focusOn(panel, "Jev routing");
		press(panel, keys.space);
		focusOn(panel, "Delegation mode");
		press(panel, keys.right);
		openReview(panel);
		head = title(panel);
		lines = body(panel);
		press(panel, keys.enter);
	});
	assert.equal(head, "Workflow config › Review");
	assert.ok(lines.some((line) => /^Changes ─+$/.test(line)));
	assert.ok(lines.some((line) => /^Child session\s+on → off$/.test(line)));
	assert.ok(lines.some((line) => /^Jev routing\s+off → on$/.test(line)));
	assert.ok(
		lines.some((line) =>
			/^Delegation mode\s+opportunistic → orchestrator$/.test(line),
		),
	);
	assert.ok(
		lines.every((line) => !line.includes("No changes to your selection.")),
	);
});

test("the review says there are no changes and lists the three lines always applied", async (t) => {
	let lines;
	await open(t, {}, (panel) => {
		openReview(panel);
		lines = body(panel);
		press(panel, keys.enter);
	});
	assert.ok(lines.includes("No changes to your selection."));
	assert.ok(lines.every((line) => !/^Packages/.test(line)));
	assert.ok(lines.some((line) => /^Always on apply ─+$/.test(line)));
	for (const line of [
		"Align MCP servers (mcp.json)",
		"Apply default Pi settings",
		"Nothing is uninstalled",
	]) {
		assert.ok(
			lines.some((entry) => entry.endsWith(line)),
			line,
		);
	}
	assert.ok(lines.includes("▸ Apply now"));
	const text = lines.join(" ").replace(/\s+/g, " ");
	assert.ok(text.includes("Enter apply"));
	assert.ok(text.includes("Esc back to edit"));
});

test("the review lists installs, kept packages, and an unreadable companion only while it is expected", async (t) => {
	let expected;
	let notExpected;
	await open(
		t,
		{ states: { [web]: "missing", [nan]: "installed", [engram]: "error" } },
		(panel) => {
			focusOn(panel, nan);
			press(panel, keys.space);
			openReview(panel);
			expected = body(panel);
			press(panel, keys.escape);
			focusOn(panel, engram);
			press(panel, keys.space);
			openReview(panel);
			notExpected = body(panel);
			press(panel, keys.enter);
		},
	);
	for (const lines of [expected, notExpected]) {
		assert.ok(lines.some((line) => /^Packages ─+$/.test(line)));
		assert.ok(lines.includes(`+ Install ${web}`));
		assert.ok(lines.includes(`= Keep ${nan} installed (not uninstalled)`));
	}
	assert.ok(
		expected.includes(
			`! ${engram} is unreadable (not reinstalled; see /workflow:doctor)`,
		),
	);
	assert.ok(
		notExpected.every((line) => !line.includes(`${engram} is unreadable`)),
	);
});

test("at a short height the review scrolls with Apply now and the hints visible", async (t) => {
	const seen = {};
	await open(
		t,
		{ states: { [web]: "missing", [nan]: "installed" } },
		(panel) => {
			for (let i = 0; i < 6; i++) press(panel, keys.space, keys.down);
			focusOn(panel, nan);
			press(panel, keys.space);
			openReview(panel);
			const frame = () => body(panel).join("\n");
			seen.first = frame();
			seen.height = plain(panel).length;
			for (let i = 0; i < 40; i++) press(panel, keys.down);
			seen.last = frame();
			for (let i = 0; i < 40; i++) press(panel, keys.up);
			seen.top = frame();
			press(panel, keys.enter);
		},
		{ rows: 14 },
	);
	assert.ok(seen.height <= 14);
	for (const frame of [seen.first, seen.last, seen.top]) {
		assert.ok(frame.includes("▸ Apply now"));
		assert.ok(frame.includes("Esc back to edit"));
		assert.ok(frame.includes("↑/↓ scroll"));
	}
	assert.ok(seen.first.includes("↓ more"));
	assert.ok(!seen.first.includes("Always on apply"));
	assert.ok(seen.last.includes("Nothing is uninstalled"));
	assert.ok(seen.last.includes("↑ more"));
	assert.ok(seen.top.includes("Changes"));
});

test("Esc from the review keeps the draft and focuses Review and apply", async (t) => {
	let after;
	const { session } = await open(t, {}, (panel, running) => {
		press(panel, keys.space);
		openReview(panel);
		const inReview = title(panel);
		press(panel, keys.escape);
		after = {
			inReview,
			asked: body(panel).join(" ").includes("Discard"),
			head: title(panel),
			focused: body(panel).find((line) => line.startsWith("▸")),
			closed: running.closed,
			row: rowOf(panel, "Child session"),
		};
		closeGuide(panel);
		closeGuide(panel);
	});
	assert.equal(after.inReview, "Workflow config › Review");
	assert.equal(after.asked, false);
	assert.equal(after.head, "Workflow config · 1 change");
	assert.match(after.focused, /^▸ Review and apply\s+1 change ›$/);
	assert.match(after.row, /^\[ \] Child session\s+•$/);
	assert.equal(after.closed, false);
	assert.equal(session.closed, true);
});

test("Esc without changes closes the guide and writes nothing", async (t) => {
	const setup = guide(t);
	let hint;
	const session = await driveConfig(setup.command, (panel) => {
		hint = body(panel).join(" ").replace(/\s+/g, " ");
		press(panel, keys.escape);
	});
	assert.ok(hint.includes("Esc close"));
	assert.equal(session.closed, true);
	await assertNothingWritten(setup.dir);
});

test("with changes the first Esc asks to discard and a second Esc closes without writing", async (t) => {
	const setup = guide(t);
	let asked;
	let afterFirst;
	const session = await driveConfig(setup.command, (panel, running) => {
		press(panel, keys.space);
		press(panel, keys.escape);
		afterFirst = running.closed;
		asked = body(panel).join(" ").replace(/\s+/g, " ");
		press(panel, keys.escape);
	});
	assert.equal(afterFirst, false);
	assert.ok(
		asked.includes(
			"Discard 1 change? Esc again discards and closes; any other key keeps editing.",
		),
	);
	assert.equal(session.closed, true);
	await assertNothingWritten(setup.dir);
});

test("discarding edits with double Esc preserves an existing valid selection byte for byte", async (t) => {
	const setup = guide(t);
	const path = join(setup.dir, "pi-workflow-selection.json");
	const original = Buffer.from(` \n{
  "expectations" : ${JSON.stringify(Object.fromEntries(companions.map(({ package: name }) => [name, true])))},
  "capabilities" : {
    "todo" : false,
    "child-session" : true,
    "operator-questions" : true,
    "model-profiles" : true,
    "codegraph" : true,
    "compact-rendering" : true
  },
  "schemaVersion" : 1
}\n\t`);
	await writeFile(path, original);
	const seen = {};
	const session = await driveConfig(setup.command, (panel, running) => {
		seen.openedTodo = rowOf(panel, "Todo");
		press(panel, keys.space);
		seen.edited = rowOf(panel, "Child session");
		press(panel, keys.escape);
		seen.closedAfterFirst = running.closed;
		seen.warning = body(panel).join(" ").includes("Discard 1 change?");
		press(panel, keys.escape);
	});
	assert.match(seen.openedTodo, /^\[ \] Todo$/);
	assert.match(seen.edited, /^▸ \[ \] Child session\s+•$/);
	assert.equal(seen.closedAfterFirst, false);
	assert.equal(seen.warning, true);
	assert.equal(session.closed, true);
	assert.deepEqual(await readFile(path), original);
});

test("any other key after the first Esc dismisses the warning and keeps the draft", async (t) => {
	let kept;
	await open(t, {}, (panel, running) => {
		press(panel, keys.space);
		press(panel, keys.escape);
		press(panel, keys.down);
		kept = {
			text: body(panel).join(" ").replace(/\s+/g, " "),
			head: title(panel),
			closed: running.closed,
		};
		press(panel, keys.escape);
		kept.askedAgain = body(panel).join(" ").includes("Discard 1 change?");
		press(panel, keys.escape);
	});
	assert.ok(!kept.text.includes("Discard 1 change?"));
	assert.equal(kept.head, "Workflow config · 1 change");
	assert.equal(kept.closed, false);
	assert.equal(kept.askedAgain, true);
});

test("the mouse wheel moves the focus in the list and scrolls the review", async (t) => {
	const seen = {};
	await open(
		t,
		{ states: { [web]: "missing", [nan]: "installed" } },
		(panel) => {
			wheel(panel, 1);
			seen.down = body(panel).find((line) => line.startsWith("▸"));
			wheel(panel, -1);
			seen.up = body(panel).find((line) => line.startsWith("▸"));
			closeGuide(panel);
		},
	);
	assert.match(seen.down, /^▸ \[x\] Todo$/);
	assert.match(seen.up, /^▸ \[x\] Child session$/);

	await open(
		t,
		{ states: { [web]: "missing", [nan]: "installed" } },
		(panel) => {
			for (let i = 0; i < 6; i++) press(panel, keys.space, keys.down);
			openReview(panel);
			seen.before = body(panel).join("\n");
			wheel(panel, 3);
			seen.after = body(panel).join("\n");
			press(panel, keys.escape);
			closeGuide(panel);
			closeGuide(panel);
		},
		{ rows: 14 },
	);
	assert.ok(seen.before.includes("Changes"));
	assert.match(seen.after, /↑↓? more/);
	assert.notEqual(seen.before, seen.after);
});

test("a click on a row focuses and changes it, on Review and apply opens the review, and on Apply now applies", async (t) => {
	let mid;
	const setup = guide(t);
	await driveConfig(setup.command, (panel) => {
		click(panel, 10, lineIndex(panel, "] Todo"));
		mid = {
			todo: rowOf(panel, "Todo"),
			head: title(panel),
		};
		click(panel, 10, lineIndex(panel, "Delegation mode"));
		mid.mode = rowOf(panel, "Delegation mode");
		click(panel, 10, lineIndex(panel, "Review and apply"));
		mid.review = title(panel);
		click(panel, 10, lineIndex(panel, "Apply now"));
	});
	assert.match(mid.todo, /^▸ \[ \] Todo\s+•$/);
	assert.equal(mid.head, "Workflow config · 1 change");
	assert.match(mid.mode, /^▸\s+Delegation mode\s+‹ orchestrator ›\s+•$/);
	assert.equal(mid.review, "Workflow config › Review");
	const stored = await storedSelection(setup.dir);
	assert.equal(stored.capabilities.todo, false);
	assert.equal(
		JSON.parse(
			await readFile(join(setup.dir, "pi-workflow-delegation.json"), "utf8"),
		).delegationMode,
		"orchestrator",
	);
});

test("[×] closes without changes, asks to discard with changes, and returns from the review like Esc", async (t) => {
	const none = guide(t);
	const noneSession = await driveConfig(none.command, (panel) => {
		const { x, y } = closeSpan(panel);
		click(panel, x, y);
	});
	assert.equal(noneSession.closed, true);

	const some = guide(t);
	const seen = {};
	const session = await driveConfig(some.command, (panel, running) => {
		press(panel, keys.space);
		const { x, y } = closeSpan(panel);
		click(panel, x, y);
		seen.asked = body(panel).join(" ").includes("Discard 1 change?");
		seen.closedAfterFirst = running.closed;
		press(panel, keys.down);
		openReview(panel);
		click(panel, x, y);
		seen.back = title(panel);
		seen.focused = body(panel).find((line) => line.startsWith("▸"));
		click(panel, x, y);
		click(panel, x, y);
	});
	assert.equal(seen.asked, true);
	assert.equal(seen.closedAfterFirst, false);
	assert.equal(seen.back, "Workflow config · 1 change");
	assert.match(seen.focused, /^▸ Review and apply/);
	assert.equal(session.closed, true);
	await assertNothingWritten(some.dir);
});

test("applying with no changes still saves the selection and runs setup for the expected companions", async (t) => {
	const installs = [];
	const setup = guide(t, {
		states: { [web]: "missing" },
		exec: async (command, args) => {
			installs.push([command, args]);
			return { code: 0 };
		},
	});
	await driveConfig(setup.command, (panel) => {
		openReview(panel);
		press(panel, keys.enter);
	});
	assert.deepEqual(installs, [["pi", ["install", `npm:${web}`]]]);
	const stored = await storedSelection(setup.dir);
	assert.equal(stored.expectations[web], true);
	assert.ok(Object.values(stored.capabilities).every(Boolean));
});

test("every rendered line stays within the width in the review", async (t) => {
	const lengths = [];
	await open(
		t,
		{ states: { [web]: "missing", [nan]: "installed", [engram]: "error" } },
		(panel) => {
			press(panel, keys.space);
			openReview(panel);
			for (const width of [30, 40, 56, 80, 120]) {
				for (const line of panel.render(width))
					lengths.push([width, visibleWidth(line)]);
			}
			press(panel, keys.enter);
		},
		{ rows: 14 },
	);
	assert.ok(lengths.every(([width, length]) => length <= width));
});

test("a short terminal keeps the focused row, the warning and the hints in the list", async (t) => {
	const rows = 12;
	const width = 48;
	const seen = [];
	const snap = (panel, label) => {
		const lines = plain(panel, width);
		seen.push({
			label,
			height: lines.length,
			widest: Math.max(...lines.map((line) => visibleWidth(line))),
			focused: body(panel, width).find((line) => line.startsWith("▸")),
			text: body(panel, width).join(" ").replace(/\s+/g, " "),
		});
	};
	await open(
		t,
		{},
		(panel) => {
			press(panel, keys.space);
			focusOn(panel, "Delegation mode");
			press(panel, keys.right);
			snap(panel, "orchestrator");
			press(panel, keys.up);
			snap(panel, "up");
			press(panel, keys.escape);
			snap(panel, "up discard");
			press(panel, "a");
			press(panel, keys.down);
			snap(panel, "down");
			press(panel, keys.escape);
			snap(panel, "down discard");
			press(panel, "a");
			focusOn(panel, "Review and apply");
			snap(panel, "action");
			press(panel, keys.escape);
			snap(panel, "action discard");
			press(panel, "a");
			press(panel, keys.up);
			snap(panel, "companion");
			press(panel, keys.escape);
			snap(panel, "companion discard");
			press(panel, "a");
			closeGuide(panel);
			closeGuide(panel);
		},
		{ rows },
	);
	const [orchestrator, up, down, action, companion] = seen.filter((frame) => !frame.label.endsWith("discard"));
	assert.match(orchestrator.focused, /^▸\s+Delegation mode\s+‹ orchestrator ›/);
	assert.ok(
		orchestrator.text.includes(
			"No effect while Child session is off: the parent has no child tools to delegate with.",
		),
	);
	assert.match(up.focused, /^▸\s+\[.\] Jev routing/);
	assert.match(down.focused, /^▸\s+Delegation mode/);
	assert.match(action.focused, /^▸\s+Review and apply/);
	assert.match(companion.focused, /^▸\s+\[.\] \S+\s+\S+/);
	assert.ok(!companion.focused.includes("Review and apply"));
	for (const frame of seen) {
		assert.ok(frame.height <= rows, `${frame.label}: ${frame.height} rows`);
		assert.ok(frame.widest <= width, frame.label);
		assert.ok(frame.text.includes("↑/↓ move"), frame.label);
		assert.ok(frame.text.includes("Esc"), frame.label);
	}
});

test("PageUp and PageDown expose the full focused description at 12x48 without moving focus", async (t) => {
	await open(t, {}, (panel) => {
		press(panel, keys.space);
		focusOn(panel, "Delegation mode");
		press(panel, keys.right);
		const frames = [];
		for (let i = 0; i < 20; i++) {
			frames.push(body(panel, 48));
			press(panel, "\x1b[6~");
		}
		const first = frames[0].join(" ");
		assert.ok(first.includes("PgUp/PgDn description"));
		assert.ok(first.includes("↓ more"));
		const copy = frames.flatMap((lines) => lines.slice(
			lines.findIndex((line) => line.startsWith("▸")) + 1,
			lines.findIndex((line) => line.includes("more")),
		));
		const unique = [...new Set(copy)].join(" ").replace(/\s+/g, " ");
		assert.ok(unique.includes("opportunistic: the parent decides per message whether to delegate (default)."), unique);
		assert.ok(unique.includes("orchestrator: the parent is told to delegate all work to child sessions and keep to conversing, planning, asking, and directing children."), unique);
		assert.ok(frames.at(-1).join(" ").includes("↑ more"));
		for (const lines of frames) {
			const text = lines.join(" ").replace(/\s+/g, " ");
			assert.ok(lines.length + 2 <= 12);
			assert.ok(lines.every((line) => visibleWidth(line) <= 48));
			assert.ok(lines.some((line) => /^▸\s+Delegation mode/.test(line)));
			assert.ok(text.includes("No effect while Child session is off: the parent has no child tools to delegate with."));
			assert.ok(text.includes("↑/↓ move"));
			assert.ok(text.includes("Esc"));
		}
		for (let i = 0; i < 20; i++) press(panel, "\x1b[5~");
		assert.deepEqual(body(panel, 48), frames[0]);
		closeGuide(panel);
	}, { rows: 12 });
});

test("discard confirmation at 12x48 keeps the complete frame and paged description accessible", async (t) => {
	const setup = guide(t);
	const session = await driveConfig(setup.command, (panel, running) => {
		press(panel, keys.space);
		for (let i = 0; i < 7; i++) press(panel, keys.down);
		press(panel, keys.right);
		assert.equal(plain(panel, 48).length, 12);
		press(panel, keys.escape);
		const frames = [];
		const descriptionLines = [];
		const snap = () => {
			const lines = plain(panel, 48);
			const text = body(panel, 48).join(" ").replace(/\s+/g, " ");
			assert.ok(lines.length <= 12, `${lines.length} rows`);
			assert.ok(lines.every((line) => visibleWidth(line) <= 48));
			assert.match(text, /▸\s+Delegation mode\s+‹ orchestrator ›/);
			assert.ok(text.includes("No effect while Child session is off: the parent has no child tools to delegate with."));
			assert.ok(text.includes("↑/↓ move"));
			assert.ok(text.includes("←/→/Space change"));
			assert.ok(text.includes("Tab go to apply"));
			assert.ok(text.includes("Esc discard changes"));
			assert.ok(text.includes("PgUp/PgDn description"));
			return text;
		};
		const notice = snap();
		assert.ok(notice.includes("Discard 2 changes? Esc again discards and closes; any other key keeps editing."));
		assert.equal(running.closed, false);
		click(panel, 10, lineIndex(panel, "Delegation mode", 48));
		assert.match(rowOf(panel, "Delegation mode", 48), /‹ opportunistic ›/);
		assert.ok(!body(panel, 48).join(" ").includes("Discard 2 changes?"));
		press(panel, keys.right);
		press(panel, keys.escape);
		snap();
		press(panel, "a");
		assert.ok(!snap().includes("Discard 2 changes?"));
		for (let i = 0; i < 20; i++) {
			frames.push(snap());
			const lines = body(panel, 48);
			descriptionLines.push(...lines.slice(
				lines.findIndex((line) => line.startsWith("▸")) + 1,
				lines.findIndex((line) => line.includes("more")),
			));
			press(panel, "\x1b[6~");
		}
		const copy = [...new Set(descriptionLines)].join(" ").replace(/\s+/g, " ");
		assert.ok(copy.includes("opportunistic: the parent decides per message whether to delegate (default)."));
		assert.ok(copy.includes("orchestrator: the parent is told to delegate all work to child sessions and keep to conversing, planning, asking, and directing children."));
		assert.ok(frames[0].includes("↓ more"));
		assert.ok(frames.at(-1).includes("↑ more"));
		for (let i = 0; i < 20; i++) press(panel, "\x1b[5~");
		assert.equal(snap(), frames[0]);
		press(panel, keys.escape);
		snap();
		press(panel, keys.escape);
	}, { rows: 12 });
	assert.equal(session.closed, true);
	await assertNothingWritten(setup.dir);
});

test("focus navigation resets description scrolling and normal-height descriptions need no scroll hint", async (t) => {
	await open(t, {}, (panel) => {
		press(panel, keys.space);
		focusOn(panel, "Delegation mode");
		press(panel, keys.right);
		const first = body(panel, 48);
		const navigate = [
			() => press(panel, keys.up, keys.down),
			() => { wheel(panel, -1); wheel(panel, 1); },
		];
		for (const move of navigate) {
			for (let i = 0; i < 20; i++) {
				press(panel, "\x1b[6~");
				body(panel, 48);
			}
			assert.notDeepEqual(body(panel, 48), first);
			move();
			assert.deepEqual(body(panel, 48), first);
		}
		closeGuide(panel);
	}, { rows: 12 });
	await open(t, {}, (panel) => {
		focusOn(panel, "Delegation mode");
		const before = body(panel, 48);
		assert.ok(!before.join(" ").includes("PgUp/PgDn"));
		assert.ok(!before.join(" ").includes("more"));
		press(panel, "\x1b[6~", "\x1b[5~");
		assert.deepEqual(body(panel, 48), before);
		closeGuide(panel);
	});
});

for (const mechanism of ["click", "Tab"]) {
	test(`${mechanism} immediately resets the overflowing destination description to its first page`, async (t) => {
		const width = mechanism === "click" ? 30 : 48;
		await open(t, {}, (panel) => {
			const destination = mechanism === "Tab" ? "Review and apply" : "Jev routing";
			focusOn(panel, destination);
			const first = body(panel, width);
			assert.ok(first.some((line) => line.startsWith("▸") && line.includes(destination)));
			assert.ok(first.join(" ").includes("PgUp/PgDn description"));
			for (let i = 0; i < 20; i++) {
				press(panel, "\x1b[6~");
				body(panel, width);
			}
			assert.notDeepEqual(body(panel, width), first);
			focusOn(panel, "Delegation mode");
			for (let i = 0; i < 20; i++) {
				body(panel, width);
				press(panel, "\x1b[6~");
			}
			if (mechanism === "Tab") press(panel, keys.tab);
			else click(panel, 10, lineIndex(panel, "Jev routing", 200));
			const actual = body(panel, width);
			assert.ok(actual.some((line) => line.startsWith("▸") && line.includes(destination)));
			const description = (lines) => lines.slice(lines.findIndex((line) => line.startsWith("▸")) + 1)
				.filter((line) => !line.includes("Esc"));
			assert.deepEqual(description(actual), description(first));
			closeGuide(panel);
		}, { rows: mechanism === "click" ? 10 : 8 });
	});
}
