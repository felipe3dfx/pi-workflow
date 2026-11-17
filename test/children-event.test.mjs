import assert from "node:assert/strict";
import test from "node:test";

import { isWorking } from "../extensions/child-sessions.ts";
import {
	childrenEvent,
	createChildrenSignal,
} from "../extensions/children-event.ts";
import { insideChildTree } from "../extensions/process-tree.ts";

function signal() {
	let count = 0;
	const emitted = [];
	const children = createChildrenSignal(
		() => count,
		(event) => emitted.push(event.working),
	);
	return {
		children,
		emitted,
		set(value) {
			count = value;
			children.changed();
		},
	};
}

test("the children event is named workflow:children", () => {
	assert.equal(childrenEvent, "workflow:children");
});

test("a queued, running, or waiting child is working; an ended one is not", () => {
	for (const state of ["queued", "running", "waiting"])
		assert.equal(isWorking(state), true, state);
	for (const state of ["completed", "failed", "cancelled", "timed out"])
		assert.equal(isWorking(state), false, state);
});

test("the working count is emitted once at start and then only when it changes", () => {
	const { children, emitted, set } = signal();
	children.start();
	assert.deepEqual(emitted, [0]);
	for (const count of [0, 1, 1, 2, 2, 1, 1, 0, 0]) set(count);
	assert.deepEqual(emitted, [0, 1, 2, 1, 0]);
});

test("a start emits the current count even when it did not change", () => {
	const { children, emitted, set } = signal();
	children.start();
	set(2);
	children.start();
	assert.deepEqual(emitted, [0, 2, 2]);
});

test("nothing is emitted before the start or after the end", () => {
	const { children, emitted, set } = signal();
	set(1);
	assert.deepEqual(emitted, []);
	children.start();
	children.end();
	set(0);
	set(3);
	assert.deepEqual(emitted, [1, 0]);
});

test("an end resets a counted session to zero, and an end with no working children emits nothing", () => {
	const counted = signal();
	counted.children.start();
	counted.set(2);
	counted.children.end();
	assert.deepEqual(counted.emitted, [0, 2, 0]);

	const idle = signal();
	idle.children.start();
	idle.set(1);
	idle.set(0);
	idle.children.end();
	idle.children.end();
	assert.deepEqual(idle.emitted, [0, 1, 0]);
});

test("a process carrying the process-tree mark runs inside a child tree", () => {
	assert.equal(insideChildTree({}), false);
	assert.equal(
		insideChildTree({ PI_WORKFLOW_PROCESS_TREE: "token/id/" }),
		true,
	);
});
