import { realpathSync } from "node:fs";
import { basename } from "node:path";
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
	while [ "$#" -gt 0 ] && [ -z "$subcommand" ] && [ -z "$reserved" ]; do
		case "$1" in
		--no-pager) ;;
		-C) shift ;;
		-c|-c?*)
			key=\${1#-c};
			[ -n "$key" ] || { shift; key=\${1-}; };
			case "$key" in
			[Cc][Oo][Ll][Oo][Rr].*|[Cc][Oo][Rr][Ee].[Qq][Uu][Oo][Tt][Ee][Pp][Aa][Tt][Hh]|[Cc][Oo][Rr][Ee].[Qq][Uu][Oo][Tt][Ee][Pp][Aa][Tt][Hh]=*) ;;
			*) reserved="git -c" ;;
			esac ;;
		-*) reserved="git \${1%%=*}" ;;
		*) subcommand=$1 ;;
		esac;
		[ "$#" -gt 0 ] && shift;
	done;
	for word in "$@"; do
		[ "$word" = -- ] && break;
		case "$subcommand $word" in
		"grep -O"*|"grep -"[!-]*O*|"grep --op"*|"ls-remote -u"*|"ls-remote -"[!-]*u*|"ls-remote --u"*|"ls-remote --exe"*|*" --output"|*" --output="*)
			reserved="\${reserved:-git $subcommand}" ;;
		esac;
	done;
	[ -n "$reserved" ] || case "$subcommand" in
	""|status|diff|log|show|blame|grep|ls-files|ls-tree|ls-remote|cat-file|rev-parse|rev-list|merge-base|describe|shortlog|name-rev|for-each-ref|show-ref|show-branch|whatchanged|range-diff|diff-tree|diff-files|diff-index|cherry|count-objects|check-ignore|check-attr|var|version|help) ;;
	reflog|stash|worktree|remote|submodule|lfs)
		verb=;
		while [ "$#" -gt 0 ] && [ -z "$verb" ]; do
			case "$1" in -*) ;; *) verb=$1 ;; esac;
			shift;
		done;
		case "$subcommand $verb" in
		"reflog "|"reflog show"|"stash list"|"stash show"|"worktree list"|"remote "|"remote show"|"remote get-url"|"submodule "|"submodule status"|"submodule summary"|"lfs ls-files"|"lfs status"|"lfs env"|"lfs version") ;;
		*) reserved="git $subcommand\${verb:+ $verb}" ;;
		esac ;;
	branch|tag|config)
		list=;
		while [ "$#" -gt 0 ] && [ -z "$reserved" ]; do
			case "$subcommand $1" in
			"branch --show-current"|"branch -a"|"branch --all"|"branch -r"|"branch --remotes"|"config --show-origin") ;;
			"branch --list"|"branch -l"|"branch -v"|"branch -vv"|"branch --verbose"|"branch --contains="*|"branch --merged="*|"branch --no-merged="*|"tag -l"|"tag --list"|"config --get"|"config --get-all"|"config --get-regexp"|"config --list"|"config -l") list=1 ;;
			"branch --contains"|"branch --merged"|"branch --no-merged")
				list=1;
				case "\${2-}" in ""|-*) ;; *) shift ;; esac ;;
			"branch -"*|"tag -"*|"config -"*) reserved="git $subcommand" ;;
			*) [ -n "$list" ] || reserved="git $subcommand" ;;
			esac;
			shift;
		done;
		[ "$subcommand" = config ] && [ -z "$list" ] && reserved="git config" ;;
	*) reserved="git $subcommand" ;;
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
	auth)
		[ -n "$option" ] && verb=;
		reserved="gh auth\${verb:+ $verb}" ;;
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
	} catch (error) {
		throw new Error(`The child's worktree ${cwd} cannot be resolved.`, {
			cause: error,
		});
	}
}

export interface ChildShell {
	commandPrefix?: string;
	shellPath?: string;
}

const posixShell = /^(bash|zsh|sh|dash|ksh|mksh)$/;

export function createChildBashTool(cwd: string, shell: ChildShell = {}) {
	const commandPrefix = `unalias git gh 2>/dev/null || :\n${guard("git", gitDecision(physical(cwd)))}${guard("gh", ghDecision)}`;
	const user =
		!shell.shellPath || posixShell.test(basename(shell.shellPath)) ? shell : {};
	return defineTool(
		createBashToolDefinition(cwd, {
			commandPrefix: user.commandPrefix
				? `${user.commandPrefix}\n${commandPrefix}`
				: commandPrefix,
			shellPath: user.shellPath,
		}),
	);
}
