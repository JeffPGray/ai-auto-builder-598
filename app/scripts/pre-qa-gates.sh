#!/usr/bin/env bash
# pre-qa-gates.sh SLUG
#
# Run the deterministic gate battery BEFORE spawning qa-reviewer.
# A contrast FAIL must never cost a screenshot round (hillards round 1, 2026-08-20).
#
# Uses scripts/run-gates.mjs (the ONE registry). Do not re-derive invocations here.
set -euo pipefail
SLUG="${1:?usage: pre-qa-gates.sh SLUG}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
node scripts/stage-timer.mjs start "$SLUG" gates || true
set +e
node scripts/run-gates.mjs "$SLUG"
gate_rc=$?
node scripts/write-once-check.mjs "$SLUG"
write_rc=$?
node scripts/stage-timer.mjs end "$SLUG" gates || true
set -e
if [ "$gate_rc" -ne 0 ] || [ "$write_rc" -ne 0 ]; then
  echo "PRE_QA_GATES=FAIL slug=$SLUG gates_exit=$gate_rc write_once_exit=$write_rc — fix before qa-reviewer. Do not screenshot."
  exit 1
fi
echo "PRE_QA_GATES=PASS slug=$SLUG"
exit 0
