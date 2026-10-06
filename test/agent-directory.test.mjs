import assert from "node:assert/strict";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
	isPlainRecord,
	resolveAgentDirectory,
	writeJsonAtomically,
} from "../extensions/agent-directory.ts";

function withDirectory(t) {
	const dir = mkdtempSync(join(tmpdir(), "pi-workflow-agent-directory-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
}

function withEnvironment(t, values) {
	const previous = {};
	for (const [key, value] of Object.entries(values)) {
		previous[key] = process.env[key];
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	t.after(() => {
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	});
}

test("an injected directory wins over the environment", (t) => {
	withEnvironment(t, { PI_CODING_AGENT_DIR: "/from/environment" });
	assert.equal(resolveAgentDirectory("/injected/agent"), "/injected/agent");
});

test("without an injected directory the environment decides", (t) => {
	withEnvironment(t, {
		PI_CODING_AGENT_DIR: "/coding/agent",
		PI_AGENT_HOME: "/agent/home",
		HOME: "/home/operator",
	});
	assert.equal(resolveAgentDirectory(), "/coding/agent");
	delete process.env.PI_CODING_AGENT_DIR;
	assert.equal(resolveAgentDirectory(), "/agent/home");
	delete process.env.PI_AGENT_HOME;
	assert.equal(resolveAgentDirectory(), "/home/operator/.pi/agent");
});

test("a relative injected directory resolves to an absolute path", () => {
	assert.equal(resolveAgentDirectory("agent"), resolve("agent"));
});

test("isPlainRecord accepts objects only", () => {
	assert.equal(isPlainRecord({}), true);
	for (const value of [null, [], "text", 1, undefined]) {
		assert.equal(isPlainRecord(value), false);
	}
});

test("a write creates the document and its directory", (t) => {
	const path = join(withDirectory(t), "nested", "doc.json");
	writeJsonAtomically(path, { a: 1 });
	assert.equal(readFileSync(path, "utf8"), '{\n  "a": 1\n}\n');
});

test("a replacing write keeps the file mode and leaves no temporary file", (t) => {
	const dir = withDirectory(t);
	const path = join(dir, "doc.json");
	writeFileSync(path, "{}");
	chmodSync(path, 0o640);
	writeJsonAtomically(path, { a: 2 });
	assert.equal(statSync(path).mode & 0o777, 0o640);
	assert.deepEqual(readdirSync(dir), ["doc.json"]);
});

test("a write through a symbolic link updates the target and keeps the link", (t) => {
	const dir = withDirectory(t);
	const target = join(dir, "real.json");
	const link = join(dir, "link.json");
	writeFileSync(target, "{}");
	symlinkSync(target, link);
	writeJsonAtomically(link, { a: 3 });
	assert.equal(readFileSync(target, "utf8"), '{\n  "a": 3\n}\n');
	assert.equal(readdirSync(dir).sort().join(), "link.json,real.json");
	assert.equal(statSync(link).isFile(), true);
});

test("a write without replacement refuses a target that appeared and leaves nothing behind", (t) => {
	const dir = withDirectory(t);
	const path = join(dir, "doc.json");
	writeFileSync(path, '{"kept":true}');
	assert.throws(() => writeJsonAtomically(path, { a: 4 }, { replace: false }), {
		code: "EEXIST",
	});
	assert.equal(readFileSync(path, "utf8"), '{"kept":true}');
	assert.deepEqual(readdirSync(dir), ["doc.json"]);
});

test("a write without replacement creates an absent target and leaves no temporary file", (t) => {
	const dir = withDirectory(t);
	const path = join(dir, "doc.json");
	writeJsonAtomically(path, { a: 5 }, { replace: false });
	assert.equal(readFileSync(path, "utf8"), '{\n  "a": 5\n}\n');
	assert.deepEqual(readdirSync(dir), ["doc.json"]);
});

test("a failed write leaves no temporary file", (t) => {
	const dir = withDirectory(t);
	const path = join(dir, "doc.json");
	mkdirSync(path);
	assert.throws(() => writeJsonAtomically(path, { a: 6 }));
	assert.deepEqual(readdirSync(dir), ["doc.json"]);
});
