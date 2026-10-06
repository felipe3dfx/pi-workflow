import assert from "node:assert/strict";

import { readSelection } from "../../extensions/configure.ts";

export function selectionWith(packages, changes) {
	const read = readSelection(undefined, packages);
	assert.equal(read.status, "ready");
	Object.assign(read.selection.capabilities, changes);
	return read.selection;
}
