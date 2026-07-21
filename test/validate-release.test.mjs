import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
	validateRelease,
	validateReleaseNotes,
} from "../scripts/validate-release.mjs";

const notes = `# Notas de release — v0.1.1

Esta versión prepara una entrega verificable del workflow empaquetado.

## Migraciones

No hay migraciones de datos. Los activos gestionados conservan evidencia recuperable.

## Sync requerido

Ejecute \`pi-workflow-sync plan\` y confirme \`apply\` cuando corresponda.

## Cambios de capacidades

La aceptación valida perfiles de mínimo privilegio sin servicios activos.

## Rollback

Use \`pi-workflow-sync rollback <operationId>\` para restaurar predecesores verificados.
`;

test("release notes require the four exact non-empty operational sections", () => {
	assert.deepEqual(validateReleaseNotes(notes), {
		sections: [
			"Migraciones",
			"Sync requerido",
			"Cambios de capacidades",
			"Rollback",
		],
	});

	for (const invalid of [
		notes.replace("## Migraciones", "## Cambios internos"),
		notes.replace(
			"## Sync requerido\n\nEjecute `pi-workflow-sync plan` y confirme `apply` cuando corresponda.",
			"## Sync requerido\n\n   ",
		),
	]) {
		assert.throws(() => validateReleaseNotes(invalid), /release notes/i);
	}
});

test("release validation binds the GitHub Release tag and body to package metadata", () => {
	assert.deepEqual(
		validateRelease({
			manifest: { name: "@felipe.3dfx/pi-workflow", version: "0.1.1" },
			notes,
			tag: "v0.1.1",
			body: notes,
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
				notes,
				tag: "v0.1.2",
				body: notes,
			}),
		/release tag/i,
	);
	assert.throws(
		() =>
			validateRelease({
				manifest: { name: "@felipe.3dfx/pi-workflow", version: "0.1.1" },
				notes,
				tag: "v0.1.1",
				body: `${notes}\nContenido no aprobado.`,
			}),
		/release body/i,
	);
});

test("release files and publish workflow keep acceptance separate from publication", async () => {
	const [packageJson, releaseNotes, publishWorkflow, acceptance] =
		await Promise.all([
			readFile(new URL("../package.json", import.meta.url), "utf8").then(
				JSON.parse,
			),
			readFile(new URL("../RELEASE_NOTES.md", import.meta.url), "utf8"),
			readFile(
				new URL("../.github/workflows/publish.yml", import.meta.url),
				"utf8",
			),
			readFile(
				new URL("../scripts/check-acceptance.mjs", import.meta.url),
				"utf8",
			),
		]);
	validateReleaseNotes(releaseNotes);
	assert.equal(packageJson.files.includes("RELEASE_NOTES.md"), true);
	assert.equal(
		packageJson.scripts["check:release"],
		"node scripts/validate-release.mjs",
	);
	assert.equal(
		packageJson.scripts["check:acceptance"],
		"node scripts/check-acceptance.mjs",
	);
	assert.match(packageJson.scripts.check, /npm run check:release/);
	assert.match(packageJson.scripts.check, /npm run check:acceptance/);
	assert.equal(packageJson.scripts.prepublishOnly, "npm run check");
	assert.match(publishWorkflow, /validate-release\.mjs.*--event/);
	assert.match(publishWorkflow, /npm publish --provenance --access public/);
	assert.doesNotMatch(acceptance, /npm publish/);
});
