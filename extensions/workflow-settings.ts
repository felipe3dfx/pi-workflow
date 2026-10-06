import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { isPlainRecord, writeJsonAtomically } from "./agent-directory.ts";

type Routing = "on" | "off";

function isRouting(value: unknown): value is Routing {
	return value === "on" || value === "off";
}

export function createJevRouting(agentDirectory: string) {
	const path = resolve(agentDirectory, "pi-workflow-routing.json");

	function read(): Routing {
		try {
			const choice: unknown = JSON.parse(readFileSync(path, "utf8"));
			if (
				isPlainRecord(choice) &&
				choice.schemaVersion === 1 &&
				isRouting(choice.jevRouting)
			) {
				return choice.jevRouting;
			}
		} catch {}
		return "off";
	}

	return {
		enabled: (): boolean => read() === "on",
		set(enabled: boolean): void {
			writeJsonAtomically(path, {
				schemaVersion: 1,
				jevRouting: enabled ? "on" : "off",
			});
		},
	};
}

export type JevRouting = ReturnType<typeof createJevRouting>;
