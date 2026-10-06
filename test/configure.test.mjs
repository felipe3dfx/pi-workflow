import test from "node:test";
import assert from "node:assert/strict";

import {
	describePlan,
	planApply,
	readSelection,
} from "../extensions/configure.ts";

const packages = ["gentle-engram", "@gtrabanco/pi-nan-provider", "pi-web-access"];

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
