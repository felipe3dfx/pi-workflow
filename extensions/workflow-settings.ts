import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { isPlainRecord, writeJsonAtomically } from "./agent-directory.ts";

export const delegationModes = ["opportunistic", "orchestrator"] as const;

export type DelegationModeName = (typeof delegationModes)[number];

function isDelegationMode(value: unknown): value is DelegationModeName {
	return (delegationModes as readonly unknown[]).includes(value);
}

export function createDelegationMode(agentDirectory: string) {
	const path = resolve(agentDirectory, "pi-workflow-delegation.json");

	return {
		current(): DelegationModeName {
			try {
				const choice: unknown = JSON.parse(readFileSync(path, "utf8"));
				if (
					isPlainRecord(choice) &&
					choice.schemaVersion === 1 &&
					isDelegationMode(choice.delegationMode)
				) {
					return choice.delegationMode;
				}
			} catch {}
			return "opportunistic";
		},
		set(mode: DelegationModeName): void {
			writeJsonAtomically(path, { schemaVersion: 1, delegationMode: mode });
		},
	};
}

export type DelegationMode = ReturnType<typeof createDelegationMode>;
