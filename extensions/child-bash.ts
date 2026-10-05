import { realpathSync } from "node:fs";
import {
	createBashToolDefinition,
	defineTool,
} from "@earendil-works/pi-coding-agent";

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

function line(strings: TemplateStringsArray, ...values: string[]): string {
	return strings
		.map((part) => part.replace(/\n\t*/g, " "))
		.reduce((code, part, index) => `${code}${values[index - 1]}${part}`);
}

function guard(program: string, decision: string): string {
	return line`__pi_workflow_${program}_guard() (
	reserved=;
	${decision}
	[ -z "$reserved" ] && exit 0;
	printf '\`%s\` is reserved for the parent. Continue without it and list the exact command in your result; do not ask the parent to run it.\\n' "$reserved" >&2;
	exit 126
);
${program}() {
	__pi_workflow_${program}_guard "$@" || return 126;
	command ${program} "$@";
};`;
}

function gitDecision(root: string): string {
	return line`case "$(pwd -P)/" in
	${shellQuote(`${root}/`)}*) ;;
	*) exit 0 ;;
	esac;
	subcommand=;
	while [ "$#" -gt 0 ] && [ -z "$subcommand" ]; do
		case "$1" in
		-c)
			shift;
			case "\${1-}" in [Aa][Ll][Ii][Aa][Ss].*) reserved="git -c alias" ;; esac ;;
		-c[Aa][Ll][Ii][Aa][Ss].*) reserved="git -c alias" ;;
		-C|--git-dir|--work-tree|--namespace|--exec-path|--config-env|--attr-source) shift ;;
		-*) ;;
		*) subcommand=$1 ;;
		esac;
		[ "$#" -gt 0 ] && shift;
	done;
	verb=;
	case "$subcommand" in
	remote|submodule|reflog|lfs)
		while [ "$#" -gt 0 ] && [ -z "$verb" ]; do
			case "$1" in -*) ;; *) verb=$1 ;; esac;
			shift;
		done ;;
	esac;
	[ -n "$reserved" ] || case "$subcommand" in
	commit|merge|rebase|cherry-pick|revert|am|reset|tag|branch|update-ref|push|pull|fetch|checkout|switch|restore|clean|stash|add|rm|mv|apply|config|worktree|gc|notes|bisect|sparse-checkout|update-index|read-tree|symbolic-ref|replace|filter-branch|prune|stage|send-email|maintenance|repack)
		reserved="git $subcommand" ;;
	remote)
		case "$verb" in add|set-url|remove|rm|rename|update|prune|set-head|set-branches) reserved="git remote $verb" ;; esac ;;
	submodule)
		case "$verb" in add|update|init|deinit|sync|foreach|absorbgitdirs|set-branch|set-url) reserved="git submodule $verb" ;; esac ;;
	reflog)
		case "$verb" in expire|delete) reserved="git reflog $verb" ;; esac ;;
	lfs)
		[ "$verb" = push ] && reserved="git lfs push" ;;
	esac;`;
}

const ghDecision = line`group=;
	verb=;
	option=;
	while [ "$#" -gt 0 ] && [ -z "$verb" ]; do
		case "$1" in
		-R|--repo) shift ;;
		--repo=*) ;;
		-*) option=1 ;;
		*) if [ -z "$group" ]; then group=$1; else verb=$1; fi ;;
		esac;
		[ "$#" -gt 0 ] && shift;
	done;
	case "$group" in
	""|help|search) ;;
	*)
		[ -n "$option" ] && verb=;
		case "$verb" in
		view|list|diff|checks|status|watch|download) ;;
		clone) [ "$group" = repo ] || reserved="gh $group $verb" ;;
		*) reserved="gh $group\${verb:+ $verb}" ;;
		esac ;;
	esac;`;

function physical(cwd: string): string {
	try {
		return realpathSync(cwd);
	} catch {
		return cwd;
	}
}

export function createChildBashTool(
	cwd: string,
	userPrefix?: string,
) {
	const commandPrefix = `unalias git gh 2>/dev/null\n${guard("git", gitDecision(physical(cwd)))}${guard("gh", ghDecision)}`;
	return defineTool(
		createBashToolDefinition(cwd, {
			commandPrefix: userPrefix
				? `${userPrefix}\n${commandPrefix}`
				: commandPrefix,
		}),
	);
}
