import { realpathSync } from "node:fs";
import {
	createBashToolDefinition,
	defineTool,
} from "@earendil-works/pi-coding-agent";

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

function guard(program: string, decision: string): string {
	return `__pi_workflow_${program}_guard() (
	reserved=
${decision}	[ -z "$reserved" ] && exit 0
	printf '\`%s\` is reserved for the parent. Continue without it and list the exact command in your result; do not ask the parent to run it.\\n' "$reserved" >&2
	exit 126
)
${program}() {
	__pi_workflow_${program}_guard "$@" || return 126
	command ${program} "$@"
}
`;
}

function gitDecision(root: string): string {
	return `	case "$(pwd -P)/" in
	${shellQuote(`${root}/`)}*) ;;
	*) exit 0 ;;
	esac
	subcommand=
	while [ "$#" -gt 0 ] && [ -z "$subcommand" ]; do
		case "$1" in
		-C|-c|--git-dir|--work-tree|--namespace|--exec-path|--config-env|--attr-source) shift ;;
		-*) ;;
		*) subcommand=$1 ;;
		esac
		[ "$#" -gt 0 ] && shift
	done
	case "$subcommand" in
	commit|merge|rebase|cherry-pick|revert|am|reset|tag|branch|update-ref|push|pull|fetch|checkout|switch|restore|clean|stash|add|rm|mv|apply|config|worktree|gc|notes)
		reserved="git $subcommand" ;;
	esac
`;
}

const ghDecision = `	group=
	verb=
	while [ "$#" -gt 0 ] && [ -z "$verb" ]; do
		case "$1" in
		-R|--repo) shift ;;
		-*) ;;
		*) if [ -z "$group" ]; then group=$1; else verb=$1; fi ;;
		esac
		[ "$#" -gt 0 ] && shift
	done
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

export function createChildBashTool(cwd: string) {
	return defineTool(
		createBashToolDefinition(cwd, {
			commandPrefix:
				guard("git", gitDecision(realpathSync(cwd))) + guard("gh", ghDecision),
		}),
	);
}
