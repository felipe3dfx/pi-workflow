import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { writeJsonAtomically } from "./agent-directory.ts";
import { readSelection, type Selection } from "./configure.ts";
import { replaceSelection } from "./shell.ts";

export type SeatingRead =
	| { status: "absent"; selection: Selection }
	| { status: "ready"; selection: Selection }
	| { status: "refused"; reason: string };

export type Offer = () => void | Promise<void>;

export function createSeating({
	agentDirectory,
	packages,
	offers,
}: {
	agentDirectory: string;
	packages: () => { packages: readonly string[]; error?: string };
	offers: readonly Offer[];
}) {
	const selectionPath = resolve(agentDirectory, "pi-workflow-selection.json");

	function read(): SeatingRead {
		const loaded = packages();
		if (loaded.error) return { status: "refused", reason: loaded.error };
		let text: string | undefined;
		try {
			text = readFileSync(selectionPath, "utf8");
		} catch (error) {
			const code =
				error instanceof Error && "code" in error ? error.code : undefined;
			if (code !== "ENOENT") {
				return {
					status: "refused",
					reason: `Unable to read the selection: ${error instanceof Error ? error.message : String(error)}`,
				};
			}
		}
		const selection = readSelection(text, loaded.packages);
		if (selection.status === "refused") return selection;
		return { status: text === undefined ? "absent" : "ready", selection: selection.selection };
	}

	async function seat(selection?: Selection) {
		if (selection) replaceSelection(selection);
		for (const offer of offers) await offer();
	}

	function save(selection: Selection) {
		writeJsonAtomically(selectionPath, selection);
	}

	return { read, seat, save };
}
