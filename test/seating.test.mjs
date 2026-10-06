import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { capabilities, readSelection } from "../extensions/configure.ts";
import { createSeating } from "../extensions/seating.ts";
import { replaceSelection, seated } from "../extensions/shell.ts";

const names = ["alpha", "beta"];
const loadedPackages = () => ({ packages: names });

function noneSeated() {
	return {
		schemaVersion: 1,
		capabilities: Object.fromEntries(capabilities.map((c) => [c, false])),
		expectations: {},
	};
}

function selectionWith(changes) {
	const read = readSelection(undefined, names);
	assert.equal(read.status, "ready");
	Object.assign(read.selection.capabilities, changes);
	return read.selection;
}

function setup(t, { offers = [], packages = loadedPackages } = {}) {
	const dir = mkdtempSync(join(tmpdir(), "pi-workflow-seating-"));
	replaceSelection(noneSeated());
	t.after(() => {
		replaceSelection(noneSeated());
		rmSync(dir, { recursive: true, force: true });
	});
	const seating = createSeating({ agentDirectory: dir, packages, offers });
	return { dir, seating };
}

const path = (dir) => join(dir, "pi-workflow-selection.json");

test("an absent selection reads as the default and seats nothing", (t) => {
	const { seating } = setup(t);
	const read = seating.read();
	assert.equal(read.status, "absent");
	assert.deepEqual(read.selection, selectionWith({}));
	assert.equal(seated("child-session", "header"), false);
});

test("a ready selection reads without seating it", (t) => {
	const { dir, seating } = setup(t);
	const selection = selectionWith({ todo: false });
	writeFileSync(path(dir), JSON.stringify(selection));
	assert.deepEqual(seating.read(), { status: "ready", selection });
	assert.equal(seated("child-session", "header"), false);
});

test("an invalid selection is refused with its reason", (t) => {
	const { dir, seating } = setup(t);
	writeFileSync(path(dir), "{nope");
	assert.deepEqual(seating.read(), {
		status: "refused",
		reason: "Selection is not valid JSON.",
	});
});

test("an unreadable selection is refused with the read error", (t) => {
	const { dir, seating } = setup(t);
	mkdirSync(path(dir));
	const read = seating.read();
	assert.equal(read.status, "refused");
	assert.match(read.reason, /^Unable to read the selection: /);
});

test("a companion catalog error is refused with its text", (t) => {
	const { seating } = setup(t, {
		packages: () => ({ packages: [], error: "Catalog is broken." }),
	});
	assert.deepEqual(seating.read(), {
		status: "refused",
		reason: "Catalog is broken.",
	});
});

test("a saved selection reads back identical", (t) => {
	const { seating } = setup(t);
	const selection = selectionWith({ codegraph: false });
	seating.save(selection);
	assert.deepEqual(seating.read(), { status: "ready", selection });
});

test("saving fails when the write fails", (t) => {
	const { dir, seating } = setup(t);
	mkdirSync(path(dir));
	assert.throws(() => seating.save(selectionWith({})));
});

test("seating replaces the seated selection before the first offer runs", async (t) => {
	const seenSeated = [];
	const { seating } = setup(t, {
		offers: [() => seenSeated.push(seated("todo", "above-input"))],
	});
	await seating.seat(selectionWith({}));
	assert.deepEqual(seenSeated, [true]);
});

test("seating without a selection keeps the current seating and still offers", async (t) => {
	let offered = 0;
	const { seating } = setup(t, { offers: [() => offered++] });
	replaceSelection(selectionWith({ todo: true, "child-session": false }));
	await seating.seat();
	assert.equal(offered, 1);
	assert.equal(seated("todo", "above-input"), true);
	assert.equal(seated("child-session", "header"), false);
});

test("offers run in list order and each is awaited", async (t) => {
	const events = [];
	const slow = (name) => async () => {
		events.push(`${name}:start`);
		await new Promise((resolve) => setTimeout(resolve, 5));
		events.push(`${name}:end`);
	};
	const { seating } = setup(t, { offers: [slow("a"), slow("b"), slow("c")] });
	await seating.seat(selectionWith({}));
	assert.deepEqual(events, [
		"a:start",
		"a:end",
		"b:start",
		"b:end",
		"c:start",
		"c:end",
	]);
});

test("a failed offer stops the later ones and keeps the new selection", async (t) => {
	const ran = [];
	const { seating } = setup(t, {
		offers: [
			() => ran.push("a"),
			() => {
				throw new Error("offer b failed");
			},
			() => ran.push("c"),
		],
	});
	await assert.rejects(seating.seat(selectionWith({ todo: true })), /offer b failed/);
	assert.deepEqual(ran, ["a"]);
	assert.equal(seated("todo", "above-input"), true);
});
