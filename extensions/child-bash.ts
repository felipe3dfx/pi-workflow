import {
	accessSync,
	constants,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import {
	createBashToolDefinition,
	defineTool,
} from "@earendil-works/pi-coding-agent";

const stubs = new Map<string, string>();

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

function realProgram(program: string): string | undefined {
	for (const dir of (process.env.PATH ?? "").split(delimiter)) {
		if (!dir) continue;
		const candidate = join(dir, program);
		try {
			accessSync(candidate, constants.X_OK);
			return candidate;
		} catch {}
	}
	return undefined;
}

function stub(program: string, decision: string): string {
	const real = realProgram(program);
	return `#!/bin/sh
reserved=
${decision}if [ -n "$reserved" ]; then
	printf '\`%s\` is reserved for the parent. Continue without it and list the exact command in your result; do not ask the parent to run it.\\n' "$reserved" >&2
	exit 126
fi
${
	real
		? `exec ${shellQuote(real)} "$@"`
		: `echo "${program}: command not found" >&2\nexit 127`
}
`;
}

function gitDecision(root: string): string {
	return `subcommand=
find_subcommand() {
	while [ "$#" -gt 0 ] && [ -z "$subcommand" ]; do
		case "$1" in
		-C|-c|--git-dir|--work-tree|--namespace|--exec-path|--config-env|--attr-source) shift ;;
		-*) ;;
		*) subcommand=$1 ;;
		esac
		[ "$#" -gt 0 ] && shift
	done
}
case "$(pwd -P)/" in
${shellQuote(`${root}/`)}*)
	find_subcommand "$@"
	case "$subcommand" in
	commit|merge|rebase|cherry-pick|revert|am|reset|tag|branch|update-ref|push|pull|fetch|checkout|switch|restore|clean|stash|add|rm|mv|apply|config|worktree|gc|notes)
		reserved="git $subcommand" ;;
	esac ;;
esac
`;
}

const ghDecision = `group=
verb=
find_command() {
	while [ "$#" -gt 0 ] && [ -z "$verb" ]; do
		case "$1" in
		-R|--repo) shift ;;
		-*) ;;
		*) if [ -z "$group" ]; then group=$1; else verb=$1; fi ;;
		esac
		[ "$#" -gt 0 ] && shift
	done
}
find_command "$@"
case "$verb" in
create|edit|merge|close|reopen|delete|comment|review|rerun|cancel|ready|checkout)
	reserved="gh $group $verb" ;;
esac
case "$group" in
api) reserved="gh api" ;;
auth|secret|release) reserved="gh $group\${verb:+ $verb}" ;;
workflow) [ "$verb" = run ] && reserved="gh workflow run" ;;
esac
`;

function stubDirectory(cwd: string): string {
	const root = realpathSync(cwd);
	const cached = stubs.get(root);
	if (cached) return cached;
	const dir = mkdtempSync(join(tmpdir(), "pi-workflow-child-bash-"));
	writeFileSync(join(dir, "git"), stub("git", gitDecision(root)), {
		mode: 0o755,
	});
	writeFileSync(join(dir, "gh"), stub("gh", ghDecision), { mode: 0o755 });
	stubs.set(root, dir);
	return dir;
}

export function removeStubDirectories() {
	for (const dir of stubs.values()) rmSync(dir, { recursive: true, force: true });
	stubs.clear();
}

export function createChildBashTool(cwd: string) {
	return defineTool(
		createBashToolDefinition(cwd, {
			spawnHook: (context) => ({
				...context,
				env: {
					...context.env,
					PATH: [stubDirectory(cwd), context.env.PATH]
						.filter(Boolean)
						.join(delimiter),
				},
			}),
		}),
	);
}
