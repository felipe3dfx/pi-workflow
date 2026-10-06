import test from "node:test";
import assert from "node:assert/strict";

import { readSelection } from "../extensions/configure.ts";
import {
	contribute,
	occupants,
	occupyAboveInput,
	paintAboveInput,
	readPlace,
	replaceSelection,
	resetPlaces,
	seated,
} from "../extensions/shell.ts";

const packages = ["gentle-engram", "@gtrabanco/pi-nan-provider", "pi-web-access"];

function selectionWith(changes) {
	const selection = readSelection(undefined, packages);
	assert.equal(selection.status, "ready");
	Object.assign(selection.selection.capabilities, changes);
	return selection.selection;
}

test("reading the absent-file selection seats no capability", () => {
	assert.equal(readSelection(undefined, packages).status, "ready");
	assert.equal(seated("child-session", "header"), false);
	assert.deepEqual(occupants("message-stream"), []);
});

test("the seated predicate answers for a declared place and follows the seating", (t) => {
	t.after(() => replaceSelection(selectionWith({})));
	replaceSelection(selectionWith({ "child-session": false }));
	assert.equal(seated("child-session", "message-stream"), false);
	assert.equal(seated("compact-rendering", "message-stream"), true);
	replaceSelection(selectionWith({}));
	assert.equal(seated("child-session", "message-stream"), true);
});

test("the seated predicate refuses a place the capability does not declare", () => {
	assert.throws(
		() => seated("todo", "message-stream"),
		/todo is not declared at message-stream/,
	);
	assert.throws(
		() => seated("compact-rendering", "overlay"),
		/compact-rendering is not declared at overlay/,
	);
});

test("an unseated occupant leaves the above-input place empty and keeps the other occupant's order", (t) => {
	t.after(() => {
		replaceSelection(selectionWith({}));
		resetPlaces();
	});
	replaceSelection(selectionWith({ "child-session": false }));
	contribute("child-session", "header", () => ({ count: 2 }));
	contribute("todo", "above-input", () => ({ count: 1 }));
	let childDrawn = false;
	occupyAboveInput("todo", () => ["todo"]);
	occupyAboveInput("child-session", () => {
		childDrawn = true;
		return ["child"];
	});

	assert.deepEqual(paintAboveInput(10), ["todo"]);
	assert.equal(childDrawn, false);
	assert.deepEqual(occupants("above-input"), ["todo"]);
	assert.equal(occupants("overlay").includes("child-session"), false);
	assert.equal(occupants("message-stream").includes("compact-rendering"), true);
	assert.equal(readPlace("header"), undefined);
	assert.deepEqual(readPlace("above-input"), { count: 1 });

	replaceSelection(selectionWith({}));
	assert.deepEqual(paintAboveInput(10), ["child", "todo"]);
});

test("a capability occupies the above-input place only where it is declared", () => {
	assert.throws(
		() => occupyAboveInput("codegraph", () => ["codegraph"]),
		/codegraph is not declared at above-input/,
	);
});
