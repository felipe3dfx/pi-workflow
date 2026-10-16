#!/usr/bin/env bash
# Human-in-the-loop reproduction loop. Copy it to hitl-loop.sh and edit the
# steps. The developer runs it in a separate interactive terminal and reports
# the printed exit=N: 1 when the bug is observed, 0 when it is not (green), and
# 125 for any other answer or a failed step, which `git bisect run` skips.
#
#   step "<instruction>"   show the instruction, wait for Enter

set -uo pipefail

finish() { printf '\nexit=%s\n' "$1"; exit "$1"; }
no_answer() {
  printf 'hitl-loop: no answer on stdin; run it in an interactive terminal\n' >&2
  return 125
}

step() {
  printf '\n>>> %s\n' "$1"
  read -r -p "    [Enter when done] " _ || no_answer
}

( set -euo pipefail
# --- edit below ---------------------------------------------------------

step "Open the app at http://localhost:3000 and sign in."
step "Click the 'Export' button."

# --- edit above ---------------------------------------------------------
)
[ $? -eq 0 ] || finish 125

printf '\n>>> Did you observe the bug? (y/n) '
read -r || { no_answer; finish 125; }
case "$(printf '%s' "$REPLY" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' | tr '[:upper:]' '[:lower:]')" in
  y | yes) finish 1 ;;
  n | no) finish 0 ;;
esac
finish 125
