import {
	accessSync,
	constants,
	mkdtempSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import {
	createBashToolDefinition,
	defineTool,
} from "@earendil-works/pi-coding-agent";

import { jevRoutingEnabled } from "./workflow-settings.ts";

const stubs = new Map<string, string>();

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

function realGit(): string | undefined {
	for (const dir of (process.env.PATH ?? "").split(delimiter)) {
		if (!dir) continue;
		const candidate = join(dir, "git");
		try {
			accessSync(candidate, constants.X_OK);
			return candidate;
		} catch {}
	}
	return undefined;
}

function blocked(program: string): string {
	return `echo "${program} runs in the parent session while Jev routing is off, so it was not run. Report blocked with this reason, or ask the parent with ask_parent." >&2\nexit 126\n`;
}

function stubDirectory(cwd: string): string {
	const root = realpathSync(cwd);
	const cached = stubs.get(root);
	if (cached) return cached;
	const dir = mkdtempSync(join(tmpdir(), "pi-workflow-child-bash-"));
	const git = realGit();
	writeFileSync(
		join(dir, "git"),
		`#!/bin/sh\ncase "$(pwd -P)/" in\n${shellQuote(`${root}/`)}*)\n${blocked("git")};;\nesac\n${
			git
				? `exec ${shellQuote(git)} "$@"\n`
				: `echo "git: command not found" >&2\nexit 127\n`
		}`,
		{ mode: 0o755 },
	);
	writeFileSync(join(dir, "gh"), `#!/bin/sh\n${blocked("gh")}`, {
		mode: 0o755,
	});
	stubs.set(root, dir);
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
								PATH: [stubDirectory(cwd), context.env.PATH]
									.filter(Boolean)
									.join(delimiter),
							},
						},
		}),
	);
}
