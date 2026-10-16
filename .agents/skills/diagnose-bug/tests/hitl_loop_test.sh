#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
template="${here}/../assets/hitl-loop.template.sh"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
status=0
steps="$(grep -c '^[[:space:]]*step ' "$template" || true)"
enters=""
for ((i = 0; i < steps; i++)); do enters+='\n'; done

run() {
  local script="$1" input="$2"
  code=0
  printf '%b' "$input" | bash "$script" >"${scratch}/out" 2>"${scratch}/err" || code=$?
  err="$(<"${scratch}/err")"
  last="$(tail -n 1 "${scratch}/out")"
}

expect() {
  local name="$1" want="$2"
  if [[ "$code" == "$want" ]]; then
    printf 'ok   %s\n' "$name"
  else
    printf 'FAIL %s: expected status %s, got %s\n--- stderr\n%s\n' "$name" "$want" "$code" "$err"
    status=1
  fi
  if [[ "$last" != "exit=${code}" ]]; then
    printf 'FAIL %s: expected last output line exit=%s, got %q\n' "$name" "$code" "$last"
    status=1
  fi
}

edited() {
  local name="$1" line="$2" answer="$3" want="$4"
  awk -v line="$line" '/^# --- edit above/ { print line } { print }' "$template" >"${scratch}/edited.sh"
  run "${scratch}/edited.sh" "${enters}${answer}\n"
  expect "$name in the edited steps with the answer ${answer} exits ${want}" "$want"
}

verdict() {
  run "$template" "${enters}${1}\n"
  expect "the answer $(printf '%q' "$(printf '%b' "$1")") exits $2" "$2"
}

verdict 'y' 1
verdict ' YES ' 1
verdict 'n' 0
verdict 'No\r' 0
verdict '' 125
verdict 'maybe' 125
verdict 'n o' 125
verdict 'y es' 125

for case in 'without input on stdin|' "that ends before the answer|${enters}"; do
  run "$template" "${case#*|}"
  expect "a run ${case%%|*} exits 125" 125
  if ! grep -Fq 'interactive terminal' <<<"$err"; then
    printf 'FAIL a run %s explains it needs an interactive terminal\n' "${case%%|*}"
    status=1
  fi
done

edited "a failing command" 'false; true' n 125
edited "a failing pipeline stage" 'false | true; true' n 125
edited "an unset variable" 'printf "%s" "$undefined_variable"' n 125
edited "an assignment to verdict" 'verdict=0' maybe 125
edited "a background command killed by its own EXIT trap" 'sleep 30 & trap "kill $!" EXIT' n 0
edited "a background command killed by its own EXIT trap" 'sleep 30 & trap "kill $!" EXIT' y 1

awk '/^# --- edit above/ { print "fi" } { print }' "$template" >"${scratch}/edited.sh"
run "${scratch}/edited.sh" "${enters}n\n"
if [[ "$code" == 0 || "$code" == 1 ]]; then
  printf 'FAIL a syntax error in the edited steps must not exit 0 or 1, got %s\n' "$code"
  status=1
else
  printf 'ok   a syntax error in the edited steps exits %s, neither 0 nor 1\n' "$code"
fi

exit "$status"
