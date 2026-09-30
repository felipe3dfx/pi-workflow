import test from "node:test";
import assert from "node:assert/strict";

import {
	claim,
	contribute,
	held,
	occupants,
	paint,
	paintPlace,
	describePlan,
	planApply,
	readPlace,
	readSelection,
	release,
	replaceSelection,
	resetPlaces,
} from "../extensions/configure.ts";
import {
	paintAboveInput,
	paintMessageStream,
	paintOverlay,
} from "../extensions/shell.ts";

const packages = ["gentle-engram", "@gtrabanco/pi-nan-provider", "pi-web-access"];

test("the absent-file preview does not seat a capability", () => {
	const selection = readSelection(undefined, packages);
	assert.equal(selection.status, "ready");
	const child = claim("child-session", "header");
	assert.equal(held(child), false);
	release(child);
});

test("a missing companion is installed only when its expectation is on", () => {
	const selection = readSelection(undefined, packages);
	assert.equal(selection.status, "ready");
	if (selection.status !== "ready") return;
	selection.selection.expectations["pi-web-access"] = false;
	selection.selection.expectations["gentle-engram"] = false;
	selection.selection.capabilities["compact-rendering"] = false;

	const plan = planApply(selection.selection, [
		{ package: "gentle-engram", status: "installed" },
		{ package: "@gtrabanco/pi-nan-provider", status: "missing" },
		{ package: "pi-web-access", status: "missing" },
	]);

	assert.deepEqual(plan.install, ["@gtrabanco/pi-nan-provider"]);
	assert.deepEqual(plan.leaveInstalled, ["gentle-engram"]);
	assert.equal(plan.install.includes("pi-web-access"), false);
	assert.equal("uninstall" in plan, false);
	assert.equal(plan.seated.includes("child-session"), true);
	assert.equal(plan.unseated.includes("compact-rendering"), true);
	assert.equal(plan.seated.includes("compact-rendering"), false);
});

test("an unseated brick leaves its place empty and keeps the other brick's order", () => {
	const selection = readSelection(undefined, packages);
	assert.equal(selection.status, "ready");
	if (selection.status !== "ready") return;
	selection.selection.capabilities["child-session"] = false;
	replaceSelection(selection.selection);
	contribute("child-session", "header", () => ({ count: 2, label: "Subagent" }));
	contribute("todo", "above-input", () => ({ count: 1 }));

	const child = claim("child-session", "above-input");
	const todo = claim("todo", "above-input");
	paint(child, () => ["child"]);
	paint(todo, () => ["todo"]);
	assert.equal(held(child), false);
	assert.equal(held(todo), true);
	assert.deepEqual(paintPlace("above-input", 10), ["todo"]);
	assert.deepEqual(paintAboveInput(10), ["todo"]);
	assert.deepEqual(paintOverlay(10), []);
	assert.deepEqual(paintMessageStream(10), []);
	release(child);
	release(todo);
	assert.deepEqual(occupants("above-input"), ["todo"]);
	assert.equal(occupants("overlay").includes("child-session"), false);
	assert.equal(occupants("message-stream").includes("compact-rendering"), true);
	assert.equal(readPlace("header"), undefined);
	assert.deepEqual(readPlace("above-input"), { count: 1 });
	const restored = readSelection(undefined, packages);
	if (restored.status === "ready") replaceSelection(restored.selection);
	resetPlaces();
});

test("the configure plan names seats, installs, and what stays installed", () => {
	const before = readSelection(undefined, packages);
	assert.equal(before.status, "ready");
	if (before.status !== "ready") return;
	const after = structuredClone(before.selection);
	after.capabilities["compact-rendering"] = false;
	after.expectations["pi-web-access"] = false;
	assert.deepEqual(
		describePlan(before.selection, after, [
			{ package: "gentle-engram", status: "installed" },
			{ package: "@gtrabanco/pi-nan-provider", status: "missing" },
			{ package: "pi-web-access", status: "installed" },
		]),
		[
			"Unseat compact-rendering",
			"Install @gtrabanco/pi-nan-provider",
			"Leave installed pi-web-access",
			"Does not uninstall packages.",
			"Aligns MCP servers and default settings.",
		],
	);
});

test("a stored selection that omits a capability is refused", () => {
	const stored = JSON.stringify({
		schemaVersion: 1,
		capabilities: { "child-session": true },
		expectations: Object.fromEntries(packages.map((name) => [name, true])),
	});
	const selection = readSelection(stored, packages);
	assert.equal(selection.status, "refused");
});
