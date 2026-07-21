import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
	validateRelease,
	validateReleaseBody,
} from "../scripts/validate-release.mjs";

const body = `# Release v0.1.1

## Implemented

Added packaged end-to-end acceptance and release provenance guards.

## Migrations

No data or schema migrations are required.

## Required sync

Run \`pi-workflow-sync inspect\`, \`plan\`, and approved \`apply\` after installation.

## Capability changes

Acceptance now covers the four public skills, sync, status, and doctor.

## Rollback

Run \`pi-workflow-sync rollback <operationId>\` or reinstall the previous package version.
`;

test("GitHub Release body requires the ordered English operational sections", () => {
	assert.deepEqual(validateReleaseBody(body, "v0.1.1"), {
		sections: [
			"Implemented",
			"Migrations",
			"Required sync",
			"Capability changes",
			"Rollback",
		],
	});
	for (const invalid of [
		body.replace("## Implemented", "## Implementado"),
		body.replace(
			"## Required sync\n\nRun `pi-workflow-sync inspect`, `plan`, and approved `apply` after installation.",
			"## Required sync\n\n   ",
		),
	]) {
		assert.throws(() => validateReleaseBody(invalid, "v0.1.1"), /Release body/i);
	}
});

test("release validation binds the GitHub Release tag and English body to package metadata", () => {
	assert.deepEqual(
		validateRelease({
			manifest: { name: "@felipe.3dfx/pi-workflow", version: "0.1.1" },
			tag: "v0.1.1",
			body,
		}),
		{
			packageName: "@felipe.3dfx/pi-workflow",
			version: "0.1.1",
			tag: "v0.1.1",
		},
	);
	assert.throws(
		() =>
			validateRelease({
				manifest: { name: "@felipe.3dfx/pi-workflow", version: "0.1.1" },
				tag: "v0.1.2",
				body,
			}),
		/release tag/i,
	);
});

test("release workflow validates per-release content separately from acceptance", async () => {
	const [packageJson, publishWorkflow, acceptance] = await Promise.all([
		readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
		readFile(new URL("../.github/workflows/publish.yml", import.meta.url), "utf8"),
		readFile(new URL("../scripts/check-acceptance.mjs", import.meta.url), "utf8"),
	]);
	assert.equal(packageJson.files.includes("RELEASE_NOTES.md"), false);
	assert.equal(packageJson.scripts["check:release"], "node scripts/validate-release.mjs");
	assert.match(publishWorkflow, /validate-release\.mjs --event/);
	assert.match(publishWorkflow, /npm publish --provenance --access public/);
	assert.doesNotMatch(acceptance, /npm\s+publish/);
});
