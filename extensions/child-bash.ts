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

const checkpointRefusal = line`case "$reserved" in
	"git add"|"git commit")
		printf '\`%s\` does not run in bash. Commit through the checkpoint tool instead.\\n' "$reserved" >&2;
		exit 126 ;;
	esac;`;

function guard(program: string, decision: string, checkpoint = false): string {
	return line`__pi_workflow_${program}_guard() (
	reserved=;
	${decision}
	[ -z "$reserved" ] && exit 0;
	${checkpoint ? checkpointRefusal : ""}
	printf '\`%s\` is reserved for the parent. Continue without it and list the exact command in your result; do not ask the parent to run it.\\n' "$reserved" >&2;
	exit 126
);
${program}() {
	__pi_workflow_${program}_guard \${1+"$@"} || return 126;
	${program === "git" ? "GIT_OPTIONAL_LOCKS=0 command git -c diff.autoRefreshIndex=false" : "command gh"} \${1+"$@"};
};`;
}

function gitRootAssignment(root: string): string {
	return line`__pi_workflow_root=${shellQuote(root)};
	case "$__pi_workflow_root" in
	/*) ;;
	*) __pi_workflow_root=$(cygpath -u "$__pi_workflow_root" 2>/dev/null) || __pi_workflow_root= ;;
	esac;`;
}

const gitDecision = line`case "$__pi_workflow_root" in
	/*)
		case "$(pwd -P)/" in
		"$__pi_workflow_root"/*) ;;
		*) exit 0 ;;
		esac ;;
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
	for word in \${1+"$@"}; do
		case "$subcommand $word" in
		"grep -O"*|"grep -"[!-]*O*|"grep --op"*|"ls-remote -u"*|"ls-remote -"[!-]*u*|"ls-remote --u"*|"ls-remote --exe"*|"archive -o"*|"archive -"[!-]*o*|"archive --o"*|"archive --r"*|"archive --e"*|*" --output"|*" --output="*)
			reserved="\${reserved:-git $subcommand}" ;;
		esac;
	done;
	[ -n "$reserved" ] || case "$subcommand" in
	""|status|diff|log|show|blame|grep|archive|ls-files|ls-tree|ls-remote|cat-file|rev-parse|rev-list|merge-base|describe|shortlog|name-rev|for-each-ref|show-ref|show-branch|whatchanged|range-diff|diff-tree|diff-files|diff-index|cherry|count-objects|check-ignore|check-attr|var|version|help) ;;
	reflog|stash|worktree|remote|submodule|lfs)
		verb=;
		case "\${1-}" in
		-*)
			for word in \${1+"$@"}; do
				case "$word" in -*) ;; *) reserved="git $subcommand" ;; esac;
			done ;;
		*) verb=\${1-} ;;
		esac;
		[ -n "$reserved" ] || case "$subcommand $verb" in
		"reflog "|"reflog show"|"stash list"|"stash show"|"worktree list"|"remote "|"remote show"|"remote get-url"|"submodule "|"submodule status"|"submodule summary"|"lfs ls-files"|"lfs status"|"lfs env"|"lfs version") ;;
		*) reserved="git $subcommand\${verb:+ $verb}" ;;
		esac ;;
	branch|tag)
		for word in \${1+"$@"}; do
			case "$subcommand $word" in
			"branch --show-current"|"branch -a"|"branch --all"|"branch -r"|"branch --remotes"|"branch --list"|"branch -l"|"branch -v"|"branch -vv"|"branch --verbose"|"branch --contains="*|"branch --merged="*|"branch --no-merged="*|"branch --points-at="*|"branch --format="*|"branch --sort="*|"tag -l"|"tag --list") ;;
			*) reserved="git $subcommand" ;;
			esac;
		done ;;
	config)
		list=;
		for word in \${1+"$@"}; do
			case "$word" in
			--show-origin) ;;
			--get|--get-all|--get-regexp|--list|-l) list=1 ;;
			-*) reserved="git config" ;;
			*) [ -n "$list" ] || reserved="git config" ;;
			esac;
		done;
		[ -n "$list" ] || reserved="git config" ;;
	*) reserved="git $subcommand" ;;
	esac;`;

const ghDecision = line`group=;
	verb=;
	option=;
	while [ "$#" -gt 0 ] && [ -z "$verb" ] && [ "$group" != api ]; do
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
	auth) reserved="gh auth" ;;
	api)
		endpoint=;
		get_method=;
		field=;
		pending_value=;
		[ -z "$option" ] || reserved="gh api";
		for word in \${1+"$@"}; do
			value_of=$pending_value;
			pending_value=;
			[ -n "$value_of" ] || case "$word" in
			--paginate|--slurp|-i|--include|--silent|--verbose) ;;
			-q|--jq|-t|--template|-p|--preview|--cache|--hostname) pending_value=any ;;
			-q?*|--jq=*|-t?*|--template=*|-p?*|--preview=*|--cache=*|--hostname=*) ;;
			-f|--raw-field) field=1; pending_value=any ;;
			-f?*|--raw-field=*) field=1 ;;
			-F|--field) field=1; pending_value=field ;;
			-F?*|--field=*) field=1; value_of=field; word=\${word#-F}; word=\${word#--field=} ;;
			-X|--method) pending_value=method ;;
			-X?*|--method=*) value_of=method; word=\${word#-X}; word=\${word#--method=}; word=\${word#=} ;;
			-H|--header) pending_value=header ;;
			-H?*|--header=*) value_of=header ;;
			-*) reserved="gh api" ;;
			*) if [ -z "$endpoint" ]; then endpoint=$word; else reserved="gh api"; fi ;;
			esac;
			case "$value_of $word" in
			"method "[Gg][Ee][Tt]) get_method=1 ;;
			method*|"header "*[Mm][Ee][Tt][Hh][Oo][Dd]*) reserved="gh api" ;;
			esac;
			[ "$value_of" != field ] || case "\${word#*=}" in
			@*) reserved="gh api" ;;
			esac;
		done;
		[ -z "$pending_value" ] || reserved="gh api";
		case "$endpoint" in
		""|*://*|[Gg][Rr][Aa][Pp][Hh][Qq][Ll]|/[Gg][Rr][Aa][Pp][Hh][Qq][Ll]) reserved="gh api" ;;
		esac;
		[ -z "$field" ] || [ -n "$get_method" ] || reserved="gh api" ;;
	*)
		[ -n "$option" ] && verb=;
		case "$verb" in
		view|list|diff|checks|status|watch) ;;
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

const posixShell = /(^|[/\\])(bash|zsh|sh|dash|ksh|mksh)(\.exe)?$/i;

// Pi starts each command's shell as a process group leader. Recorded on the first line, the group joins the
// child's process tree without shifting the line numbers the shell reports.
function recordingGroup(prefix?: string) {
	const record =
		'[ -z "$PI_WORKFLOW_PROCESS_GROUPS" ] || LC_ALL=C ps -o lstart= -p $$ > "$PI_WORKFLOW_PROCESS_GROUPS/$$" 2>/dev/null;';
	return prefix ? `${record} ${prefix}` : record;
}

export function guardPrefix(root: string, checkpoint = false): string {
	return `unalias git gh 2>/dev/null || :\n${gitRootAssignment(root)} ${guard("git", gitDecision, checkpoint)}${guard("gh", ghDecision)}`;
}

export function createChildBashTool(
	cwd: string,
	shell: ChildShell = {},
	checkpoint = false,
) {
	const commandPrefix = guardPrefix(physical(cwd), checkpoint);
	const user =
		!shell.shellPath || posixShell.test(shell.shellPath) ? shell : {};
	return defineTool(
		createBashToolDefinition(cwd, {
			commandPrefix: recordingGroup(
				user.commandPrefix
					? `${user.commandPrefix}\n${commandPrefix}`
					: commandPrefix,
			),
			shellPath: user.shellPath,
		}),
	);
}

export function createConfiguredBashTool(cwd: string, shell: ChildShell) {
	return defineTool(
		createBashToolDefinition(cwd, {
			commandPrefix: recordingGroup(shell.commandPrefix),
			shellPath: shell.shellPath,
		}),
	);
}
