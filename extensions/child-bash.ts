import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import {
	createBashToolDefinition,
	defineTool,
} from "@earendil-works/pi-coding-agent";

import { jevRoutingEnabled } from "./workflow-settings.ts";

let stubs: string | undefined;

function stubDirectory(): string {
	if (stubs) return stubs;
	const dir = mkdtempSync(join(tmpdir(), "pi-workflow-child-bash-"));
	for (const program of ["git", "gh"]) {
		writeFileSync(
			join(dir, program),
			`#!/bin/sh\necho "${program} runs in the parent session while Jev routing is off, so it was not run. Report blocked with this reason, or ask the parent with ask_parent." >&2\nexit 126\n`,
			{ mode: 0o755 },
		);
	}
	stubs = dir;
	return dir;
}

export function createChildBashTool(cwd: string) {
	return defineTool(
		createBashToolDefinition(cwd, {
			spawnHook: (context) =>
				jevRoutingEnabled()
					? context
					: {
							...context,
							env: {
								...context.env,
								PATH: [stubDirectory(), context.env.PATH]
									.filter(Boolean)
									.join(delimiter),
							},
						},
		}),
	);
}
