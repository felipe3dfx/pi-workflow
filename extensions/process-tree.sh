#!/bin/sh
# process-tree.sh <mark> <deadline ms> [watch]
# Pi starts MCP servers and shell commands in sessions of their own and an orphan
# leaves its parent's tree, so the inherited environment is the only membership
# that survives both. Stdin reaches EOF when the parent exits or is SIGKILLed.
mark=$1
rounds=$(($2 / 50))
if [ "$3" = watch ]; then cat >/dev/null; fi

members() {
	if [ -r /proc/self/environ ]; then
		grep -l -s -z "^PI_WORKFLOW_PROCESS_TREE=$mark" /proc/[0-9]*/environ |
			sed 's|^/proc/\([0-9]*\)/environ$|\1|'
	else
		# Built inside awk, the pattern appears in no command line, its own included.
		ps -A -E -ww -o pid= -o command= |
			awk -v mark="$mark" 'index($0, " PI_WORKFLOW_PROCESS_TREE=" mark) { print $1 }'
	fi
}

while [ "$rounds" -gt 0 ]; do
	pids=$(members)
	if [ -z "$pids" ]; then exit 0; fi
	kill -KILL $pids 2>/dev/null
	rounds=$((rounds - 1))
	sleep 0.05
done
exit 1
