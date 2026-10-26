#!/bin/sh
# process-tree.sh <mark> <deadline ms> <groups dir> [watch | record [pid]]
# Pi starts MCP servers and shell commands in sessions of their own and an orphan
# leaves its parent's tree, so the inherited environment and the recorded process
# groups are the only memberships that survive both. macOS hides the environment
# of platform binaries and of retitled processes such as Pi, so there only the
# groups hold. A group is named by its leader's pid and recorded with the leader's
# start time; a live process with that pid and another start time reused it.
# Stdin reaches EOF when the parent exits or is SIGKILLed.
mark=$1
rounds=$(($2 / 50))
groups=${3:?}/${mark#*/}

environment_members() {
	if [ -r /proc/self/environ ]; then
		grep -l -s -z "^PI_WORKFLOW_PROCESS_TREE=$1" /proc/[0-9]*/environ |
			sed 's|^/proc/\([0-9]*\)/environ$|\1|'
	else
		# Built inside awk, the pattern appears in no command line, its own included.
		ps -A -E -ww -o pid= -o command= |
			awk -v mark="$1" 'index($0, " PI_WORKFLOW_PROCESS_TREE=" mark) { print $1 }'
	fi
}

records() {
	if [ -d "$1" ]; then
		find "$1" -type f -exec awk '{ name = FILENAME; sub(".*/", "", name); $1 = $1; print "R", name, $0 }' {} +
	fi
}

snapshot() {
	LC_ALL=C ps -A -o pid= -o ppid= -o pgid= -o lstart= | sed 's/^/P /'
}

closure='
$1 == "E" { member[$2] = 1; next }
$1 == "O" { old[$2] = 1; next }
{ kind = $1; id = $2 }
kind == "R" { $1 = $2 = ""; sub(/^ +/, ""); recorded[id] = $0; next }
kind == "P" { ppid[id] = $3; pgid[id] = $4; $1 = $2 = $3 = $4 = ""; sub(/^ +/, ""); start[id] = $0; pids[++n] = id }
END {
	for (g in recorded) if (!(g in start) || start[g] == recorded[g]) valid[g] = 1
	for (i = 1; i <= n; i++) if (pgid[pids[i]] in valid) member[pids[i]] = 1
	do {
		grew = 0
		for (i = 1; i <= n; i++) {
			p = pids[i]
			if (!(p in member) && (ppid[p] in member || pgid[p] in member)) { member[p] = 1; grew = 1 }
		}
	} while (grew)
	for (i = 1; i <= n; i++) {
		p = pids[i]; g = pgid[p]
		if (!(p in member) || p == self || p == 1) continue
		if (mode != "record") print p
		else if (!(g in recorded) && !(g in added)) { added[g] = 1; print "add", g, (g in start ? start[g] : "-") }
	}
	if (mode != "record") exit
	for (g in recorded) if (g in start && start[g] != recorded[g]) print "drop", g
	for (g in old) {
		used = 0
		for (i = 1; i <= n; i++) if (pgid[pids[i]] == g) used = 1
		if (!used) print "drop", g
	}
}'

members() {
	{
		environment_members "$mark" | sed 's/^/E /'
		records "$groups"
		snapshot
	} | awk -v self=$$ "$closure"
}

# A group seen empty for a minute is gone for good, so its number may be reused.
record() {
	[ -d "$1" ] || return 0
	table=$(snapshot)
	for dir; do
		{
			printf '%s\n' "$table"
			environment_members "$mark${dir#"$groups"}" | sed 's/^/E /'
			if [ -n "$seed" ]; then echo "E $seed"; fi
			records "$dir"
			find "$dir" -type f -mmin +1 | sed 's|.*/|O |'
		} | awk -v self=$$ -v mode=record "$closure" | while read -r action group start; do
			case $action in
			add) printf '%s\n' "$start" >"$dir$group" ;;
			drop) rm -f "$dir$group" ;;
			esac
		done
	done
}

seed=$5
if [ "$4" = record ]; then
	record "$groups"
	exit 0
fi
if [ "$4" = watch ]; then
	if [ -r /proc/self/environ ]; then
		cat >/dev/null
	else
		# Without job control, dash reads a background job's stdin from /dev/null, its own <&0 included.
		exec 3<&0
		cat <&3 >/dev/null &
		reader=$!
		while kill -0 "$reader" 2>/dev/null; do
			record "$groups"*/
			sleep 0.5
		done
	fi
fi

# Stopped first, the tree cannot fork while the members are read again.
while [ "$rounds" -gt 0 ]; do
	pids=$(members)
	if [ -z "$pids" ]; then
		rm -rf "$groups"
		exit 0
	fi
	kill -STOP $pids 2>/dev/null
	kill -KILL $pids $(members) 2>/dev/null
	rounds=$((rounds - 1))
	sleep 0.05
done
exit 1
