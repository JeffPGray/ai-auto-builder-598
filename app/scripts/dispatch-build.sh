#!/bin/bash
# dispatch-build.sh <prompt-file> <log-file> [stall-minutes] [max-minutes]
#
# Dispatch a headless Klaudius build WITH A STALL WATCHDOG.
#
# WHY THIS EXISTS. On 2026-08-16 a build ran for 58 minutes and produced nothing. It was not
# thinking: the process sat at 0% CPU with 56 MB RSS (a working session holds ~750 MB), no file
# under clients/<slug>/ had been touched in six minutes, and the source work it HAD completed was
# never built or deployed. Jeff spotted it from the wall clock — "58 min? Seems really long" — which
# is exactly the signal a machine should be watching instead of a human.
#
# The cost of not catching it is asymmetric: a hung child burns an operator's whole evening and
# yields nothing, while the work it already finished sits on disk undeployed. At 50 builds/day an
# unwatched stall is not an inconvenience, it is a silent capacity hole.
#
# WHY ACTIVITY, NOT A PLAIN TIMEOUT. A plain timeout has to be set for the worst legitimate case
# (a 45-minute build is normal), so it cannot catch a stall at minute 6 — it just waits out the
# whole budget too. FILE ACTIVITY under the client directory is the honest liveness signal: a
# working pipeline writes constantly (gathered content, TSX, .next artefacts, status.md); a hung one
# writes nothing while still holding the process open.
#
# ⚠️ `claude -p` BUFFERS ALL OUTPUT UNTIL EXIT, so an empty log proves nothing mid-run and cannot be
# used for liveness. That is why this watches the filesystem instead.
#
# On stall it kills the child and prints WHERE it stopped, so the completed work can be salvaged —
# which is what happened here: the source was finished and only needed a build + deploy.

set -uo pipefail

PROMPT_FILE="${1:?usage: dispatch-build.sh <prompt-file> <log-file> [stall-min] [max-min]}"
LOG="${2:?need a log path}"
STALL_MIN="${3:-8}"      # no file activity for this long => hung
MAX_MIN="${4:-90}"       # absolute ceiling regardless of activity

[ -f "$PROMPT_FILE" ] || { echo "prompt file not found: $PROMPT_FILE"; exit 1; }
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1

# NOTE the flags, each learned from a failure:
#   env -u CLAUDECODE -u CLAUDE_CODE  defeats the nested-session guard
#   CLAUDE_WORKER_CHILD=1             exempts the child from the global Stop hook, which would
#                                     otherwise hand it the orchestrator's ledger and send it off
#                                     grinding our backlog instead of finishing its client
#   NO --mcp-config                   ANY form of that flag hangs `claude -p`, even pointing at an
#                                     empty config; it killed three builds with zero-byte logs
#   --strict-mcp-config (ALONE)       loads NO MCP servers. See the note below — this is a
#                                     different flag from --mcp-config and does NOT hang.
#   --effort high                     MEASURED, do not "optimise" this to medium. Head-to-head on
#                                     this project: medium 39.5 min / 8.26M tokens / 614 turns vs
#                                     high 25.2 min / 7.29M tokens / 536 turns. High is FASTER AND
#                                     CHEAPER, because token cost scales with TURNS (each turn
#                                     re-sends accumulated context) and thinking longer needs fewer
#                                     round-trips. Dropping to medium makes builds worse on every axis.
#
# WHY --strict-mcp-config (added 2026-08-16). A plugin-provided `exa-mcp-server` child attaches to
# the build and NEVER EXITS, so the parent sits holding a finished build open — measured at 36 and
# 52 minutes of phantom idle on two earlier builds, and observed live as a 74-minute-old exa child
# on the abacus build. That idle is invisible: the work is done and the site is live while the
# process tree stays up, and at 3-4 concurrent lanes it is the difference between 4 lanes and 1.
#
# The previously recorded fix was `--strict-mcp-config --mcp-config .mcp.json`, which is unusable
# because the --mcp-config half hangs the child outright. --strict-mcp-config ALONE is the third
# option neither prior note evaluated. VERIFIED: exits 0 in 3s on a trivial prompt (the no-flag
# control took 6s), so it does not hang.
#
# ⚠️ HONESTY ABOUT WHAT IS AND IS NOT PROVEN: the no-hang result is proven; the idle-hang FIX is
# NOT — a trivial prompt does not reproduce a long-session teardown, so this is reasoned from the
# flag's semantics (no MCP config loaded => no exa child to wait on), not measured end-to-end.
# Confirm on the next real build: when it finishes, `ps -Ao ppid,command | grep <pid>` should show
# NO mcp children, and wall-clock should stop exceeding last-file-write time.
#
# SAFE FOR A BUILD DISPATCH, checked per skill: build/gather/deploy/outreach/qa-fix reference
# mcp__supabase ZERO times and use scripts/db.py. Only find/follow-up/warm-leads reference the
# Supabase MCP, and each has a db.py path. Do NOT copy this flag onto a /find or /follow-up
# dispatch without re-checking that.
env -u CLAUDECODE -u CLAUDE_CODE CLAUDE_WORKER_CHILD=1 \
  claude -p --permission-mode dontAsk --model opus --effort high --strict-mcp-config \
  "$(cat "$PROMPT_FILE")" > "$LOG" 2>&1 &
CHILD=$!
echo "dispatched pid=$CHILD  stall-watchdog=${STALL_MIN}m  ceiling=${MAX_MIN}m"

started=$(date +%s)
last_change=$started

while kill -0 "$CHILD" 2>/dev/null; do
  sleep 30
  now=$(date +%s)

  # Signature of all recent client-directory writes. Cheap, and it changes whenever the pipeline
  # does anything at all — including inside a long `next build`, which touches .next constantly.
  #
  # ⛔ USE -mmin, NEVER -newermt WITH A RELATIVE STRING. BSD find (macOS) does not parse
  # "90 seconds ago"; it returns ZERO MATCHES AND EXIT 0 — a silent fail-open. Measured
  # 2026-08-16: ten consecutive `find … -newermt '5 minutes ago'` returned 0 while
  # `find … -mmin -5` returned 630 on the same tree at the same instant.
  #
  # That made this watchdog worse than useless: sig was permanently "0", so last_change never
  # advanced, and it would have KILLED EVERY HEALTHY BUILD at the ${STALL_MIN}-minute mark while
  # reporting a stall that never happened. The one thing a watchdog must never do is manufacture
  # the failure it exists to catch. -mmin takes whole minutes only, so 90s becomes 2.
  sig=$(find clients -type f -mmin -2 2>/dev/null | wc -l | tr -d ' ')
  # Any write at all in the window means alive. The previous form was
  #   if [ "$sig" != "0" ] || [ "$sig" != "$last_sig" ]
  # whose second clause can never change the outcome — the body only acts when sig != 0 — so it
  # read as if a CHANGING count mattered. It doesn't, and pretending it does hid the -newermt bug.
  [ "$sig" != "0" ] && last_change=$now

  idle=$(( (now - last_change) / 60 ))
  total=$(( (now - started) / 60 ))

  if [ "$idle" -ge "$STALL_MIN" ]; then
    echo "STALLED: no client-file activity for ${idle}m (total ${total}m). Killing pid=$CHILD."
    echo "  Salvage before re-dispatching — the source work is usually complete and only needs"
    echo "  a build + deploy. Check: grep -c secondary clients/<slug>/site/src -r ; ls clients/<slug>/site/out"
    kill "$CHILD" 2>/dev/null; sleep 2; kill -9 "$CHILD" 2>/dev/null
    exit 3
  fi
  if [ "$total" -ge "$MAX_MIN" ]; then
    echo "CEILING: ${total}m elapsed. Killing pid=$CHILD."
    kill "$CHILD" 2>/dev/null; sleep 2; kill -9 "$CHILD" 2>/dev/null
    exit 4
  fi
done

wait "$CHILD"; rc=$?
echo "child exited rc=$rc after $(( ($(date +%s) - started) / 60 ))m"
exit "$rc"
