import test from "node:test";
import assert from "node:assert/strict";

import { readSelection } from "../extensions/configure.ts";
import {
	contribute,
	occupants,
	occupyAboveInput,
	paintAboveInput,
	readPlace,
	registerShell,
	replaceSelection,
	resetPlaces,
	seated,
} from "../extensions/shell.ts";

const theme = {};
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

	assert.deepEqual(paintAboveInput(10, theme), ["todo"]);
	assert.equal(childDrawn, false);
	assert.deepEqual(occupants("above-input"), ["todo"]);
	assert.equal(occupants("overlay").includes("child-session"), false);
	assert.equal(occupants("message-stream").includes("compact-rendering"), true);
	assert.equal(readPlace("header"), undefined);
	assert.deepEqual(readPlace("above-input"), { count: 1 });

	replaceSelection(selectionWith({}));
	assert.deepEqual(paintAboveInput(10, theme), ["child", "todo"]);
});

test("a capability occupies the above-input place only where it is declared", () => {
	assert.throws(
		() => occupyAboveInput("codegraph", () => ["codegraph"]),
		/codegraph is not declared at above-input/,
	);
});

test("a second occupation of the above-input place replaces the first draw", (t) => {
	t.after(() => {
		replaceSelection(selectionWith({}));
		resetPlaces();
	});
	replaceSelection(selectionWith({}));
	occupyAboveInput("todo", () => ["first"]);
	occupyAboveInput("todo", () => ["second"]);
	assert.deepEqual(paintAboveInput(10, theme), ["second"]);
});

test("each occupant draws once per frame with the width and theme the widget was given", (t) => {
	t.after(() => {
		replaceSelection(selectionWith({}));
		resetPlaces();
	});
	replaceSelection(selectionWith({}));
	const calls = [];
	occupyAboveInput("child-session", (width, given) => {
		calls.push(["child", width, given]);
		return ["child"];
	});
	occupyAboveInput("todo", (width, given) => {
		calls.push(["todo", width, given]);
		return ["todo"];
	});
	assert.deepEqual(paintAboveInput(7, theme), ["child", "todo"]);
	assert.deepEqual(calls, [
		["child", 7, theme],
		["todo", 7, theme],
	]);
});

function shellHost() {
	const handlers = new Map();
	const widgets = [];
	const shell = registerShell({
		on: (event, handler) => handlers.set(event, handler),
	});
	const fire = (event, mode) =>
		handlers.get(event)?.(
			{},
			{
				mode,
				ui: {
					setWidget: (key, factory, options) =>
						widgets.push({ key, factory, options }),
				},
			},
		);
	return { shell, fire, widgets };
}

test("the Shell installs one above-editor widget on a TUI session start and none in other modes", async (t) => {
	t.after(() => {
		replaceSelection(selectionWith({}));
		resetPlaces();
	});
	replaceSelection(selectionWith({}));
	occupyAboveInput("todo", (width) => [`todo ${width}`]);
	const host = shellHost();
	await host.fire("session_start", "print");
	await host.fire("session_start", "rpc");
	assert.equal(host.widgets.length, 0);

	await host.fire("session_start", "tui");
	await host.fire("session_start", "tui");
	assert.equal(host.widgets.length, 2);
	assert.equal(host.widgets[1].key, "pi-workflow-above-input");
	assert.equal(host.widgets[1].options.placement, "aboveEditor");

	let renders = 0;
	const component = host.widgets[1].factory(
		{ requestRender: () => renders++ },
		theme,
	);
	assert.deepEqual(component.render(9), ["todo 9"]);
	host.shell.requestAboveInputRender();
	assert.equal(renders, 1);
	await host.fire("session_shutdown", "tui");
	host.shell.requestAboveInputRender();
	assert.equal(renders, 1);
});
