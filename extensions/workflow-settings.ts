import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
	isPlainRecord,
	resolveAgentDirectory,
	writeJsonAtomically,
} from "./agent-directory.ts";

type Routing = "on" | "off";

function isRouting(value: unknown): value is Routing {
	return value === "on" || value === "off";
}

function routingPath(): string {
	return resolve(resolveAgentDirectory(), "pi-workflow-routing.json");
}

function readRouting(): Routing {
	try {
		const choice: unknown = JSON.parse(readFileSync(routingPath(), "utf8"));
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

export function jevRoutingEnabled(): boolean {
	return readRouting() === "on";
}

export function setJevRouting(enabled: boolean): void {
	writeJsonAtomically(routingPath(), {
		schemaVersion: 1,
		jevRouting: enabled ? "on" : "off",
	});
}
