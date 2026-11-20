import { writeFileSync } from "node:fs";
import { join } from "node:path";

export function writeAdvisorModel(
	dir,
	value = { model: "fake/echo", thinking: "off" },
) {
	writeFileSync(
		join(dir, "pi-workflow-advisor.json"),
		typeof value === "string"
			? value
			: JSON.stringify({ schemaVersion: 1, ...value }),
	);
}
