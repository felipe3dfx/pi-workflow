import test from "node:test";
import assert from "node:assert/strict";

import { conflictReason, createWriteClaims, surfacesOverlap } from "../extensions/write-claims.ts";

test("disjoint paths do not overlap and a directory covers what is under it", () => {
	assert.equal(surfacesOverlap("src/a.ts", "src/b.ts"), false);
	assert.equal(surfacesOverlap("src", "src/a/b.ts"), true);
	assert.equal(surfacesOverlap("src/*.ts", "test/*.ts"), false);
	assert.equal(surfacesOverlap("src/*.ts", "src/a.ts"), true);
	assert.equal(surfacesOverlap("src/**", "src/deep/a.ts"), true);
	assert.equal(surfacesOverlap("src/{a,b}.ts", "src/c.ts"), false);
	assert.equal(surfacesOverlap("src/{a,b}.ts", "src/b.ts"), true);
});

test("entries that cannot be interpreted overlap everything", () => {
	for (const entry of ["", "/etc/passwd", "~/x", "C:/x", "../x", "a/../b", "src/[ab].ts", "src/(a|b).ts", "src\\a.ts", "a/{b,{c,d}}", "a/{b", "a/b}"]) {
		assert.equal(surfacesOverlap(entry, "docs/readme.md"), true, entry);
		assert.equal(surfacesOverlap("docs/readme.md", entry), true, entry);
	}
});

test("paths are compared without case and with canonical separators", () => {
	assert.equal(surfacesOverlap("SRC/A.ts", "src/a.ts"), true);
	assert.equal(surfacesOverlap("./src//a.ts", "src/a.ts"), true);
	assert.equal(surfacesOverlap("Docs/a.md", "src/a.md"), false);
});

test("a writer without surfaces claims the whole checkout", () => {
	const claims = createWriteClaims();
	claims.claim("one", "/repo", []);
	assert.equal(claims.conflicts("/repo", ["src/a.ts"]).length, 1);
	assert.equal(claims.conflicts("/repo", []).length, 1);
	claims.release("one");
	claims.claim("two", "/repo", ["src/a.ts"]);
	assert.equal(claims.conflicts("/repo", []).length, 1);
});

test("claims in different worktrees never conflict", () => {
	const claims = createWriteClaims();
	claims.claim("one", "/repo", []);
	assert.deepEqual(claims.conflicts("/other", []), []);
});

test("a conflict names the owner and the overlapping entries", () => {
	const claims = createWriteClaims();
	claims.claim("one", "/repo", ["src/a.ts", "docs"]);
	const found = claims.conflicts("/repo", ["SRC/*.ts", "test"]);
	assert.deepEqual(found, [{ owner: "one", pairs: [["SRC/*.ts", "src/a.ts"]] }]);
	assert.match(conflictReason(found), /child one \(`SRC\/\*\.ts` overlaps `src\/a\.ts`\)/);
});

test("release frees the surfaces and reports whether a claim existed", () => {
	const claims = createWriteClaims();
	claims.claim("one", "/repo", ["src"]);
	assert.equal(claims.release("one"), true);
	assert.equal(claims.release("one"), false);
	assert.deepEqual(claims.conflicts("/repo", ["src"]), []);
});

test("rebuild replaces every claim", () => {
	const claims = createWriteClaims();
	claims.claim("old", "/repo", []);
	claims.rebuild([
		{ owner: "a", root: "/repo", surfaces: ["src"] },
		{ owner: "b", root: "/repo", surfaces: ["docs"] },
	]);
	assert.deepEqual(claims.conflicts("/repo", ["test"]), []);
	assert.deepEqual(claims.conflicts("/repo", ["src/x.ts"]).map((c) => c.owner), ["a"]);
	assert.equal(claims.release("old"), false);
});
