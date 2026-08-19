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
#
# ⚠️ 2026-08-18 REDESIGN (Fable consult, requested by Jeff after this exact watchdog false-triggered
# twice in one session on a real client — aot-mechanical). The flaw: file-write activity answers "is
# it alive" AND "is it hung" with the same signal, but a --effort high generation turn can compose a
# large page.tsx for 10+ minutes with zero writes while burning real CPU the whole time — that read
# as a stall and got killed at minute 13 even though gather had fully completed and the build was
# healthy. Separately, the blind MAX_MIN ceiling fired mid-/deploy on the SECOND dispatch, the most
# side-effect-heavy moment (GHL contact/tag writes) — required a manual GHL query to confirm nothing
# had actually been created before it was safe to redispatch. Widening the numbers again doesn't fix
# either failure; both are the same category error twice.
#
# Fix: track file writes AND process-tree CPU as two separate liveness signals, so "silent because
# thinking" (CPU active, no writes) is distinguished from "silent because dead" (the documented 0%
# CPU / 56MB RSS incident this watchdog was originally built to catch). Three states:
#   ACTIVE     writes happening                       -> healthy, reset everything
#   COMPOSING  no writes, but CPU accruing             -> healthy, tolerate up to QUIET_MAX_MIN
#   DEAD       no writes AND ~0 CPU AND static tree    -> the real hang, kill at STALL_MIN
# The ceiling stops being a blind kill too: past MAX_MIN it only fires in a genuine quiet gap: an
# actively-writing run gets extended in logged 10-minute steps up to a HARD_MAX_MIN backstop. Under
# Klaudius's cost model (Claude subscription, not per-token API spend) extra wall-clock is ~$0; a
# kill mid-deploy costs a manual GHL audit, which is strictly more expensive. If lane-slot pressure
# at 3-4 concurrent builds ever matters more than that tradeoff, tighten HARD_MAX_MIN, not MAX_MIN.

set -uo pipefail

PROMPT_FILE="${1:?usage: dispatch-build.sh <prompt-file> <log-file> [stall-min] [max-min] [watch-dir]}"
LOG="${2:?need a log path}"
STALL_MIN="${3:-8}"        # DEAD-quiet (no writes, ~no CPU, static tree) => hung
MAX_MIN="${4:-90}"         # soft ceiling: past this, kill only at a quiet moment
WATCH_DIR="${5:-clients}"  # 2026-08-18 (Fable): scope liveness to ONE client dir for parallel dispatch —
                            # watching all of clients/ means lane B's writes reset lane A's stall timer, so
                            # a hang in one lane is invisible while any other lane is active. Pass
                            # clients/<slug> per lane once dispatch goes concurrent; single-lane default
                            # (clients) is unchanged from before.
QUIET_MAX_MIN="${QUIET_MAX_MIN:-30}"                 # CPU-active but zero writes this long => runaway
HARD_MAX_MIN="${HARD_MAX_MIN:-$(( MAX_MIN + 60 ))}"  # unconditional backstop, however lively
CPU_ACTIVE_CS="${CPU_ACTIVE_CS:-50}"                 # centiseconds of tree CPU per 30s sample counted as alive (0.5s ~= 1.7%)

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
# DISPATCH_OUTPUT_FORMAT=json (opt-in via env, default unchanged) — on a clean exit the log ends
# with a single JSON object carrying real usage/cost/duration_ms, instead of the default text
# stream. Added 2026-08-19 for Jeff's request to track real tokens/time on a dispatch, rather than
# the etime/cputime proxies used all night. Opt-in, not default, because it only pays off on a
# clean finish — a watchdog-killed run still yields a 0-byte log either way, same as today.
env -u CLAUDECODE -u CLAUDE_CODE CLAUDE_WORKER_CHILD=1 \
  claude -p --permission-mode dontAsk --model opus --effort high --strict-mcp-config \
  ${DISPATCH_OUTPUT_FORMAT:+--output-format "$DISPATCH_OUTPUT_FORMAT"} \
  "$(cat "$PROMPT_FILE")" > "$LOG" 2>&1 &
CHILD=$!
echo "dispatched pid=$CHILD  dead-quiet=${STALL_MIN}m  writeless-cap=${QUIET_MAX_MIN}m  soft-ceiling=${MAX_MIN}m  hard-cap=${HARD_MAX_MIN}m"

# All live pids in the tree rooted at $1. macOS pgrep -P takes a comma-separated ppid list.
tree_pids() {
  local frontier="$1" all="$1" kids
  while :; do
    kids=$(pgrep -P "$(echo "$frontier" | tr ' ' ',')" 2>/dev/null | tr '\n' ' ')
    kids=$(echo $kids)                 # normalise whitespace; empty when no children
    [ -z "$kids" ] && break
    all="$all $kids"; frontier="$kids"
  done
  echo "$all"
}

# Total cputime of the given pids, integer centiseconds. Handles mm:ss.cc and hh:mm:ss.cc.
tree_cpu_cs() {
  ps -o cputime= -p "$(echo "$1" | tr ' ' ',')" 2>/dev/null | awk -F'[:.]' '
    { if (NF==4) cs += (($1*3600)+($2*60)+$3)*100+$4
      else       cs += (($1*60)+$2)*100+$3 }
    END { printf "%d\n", cs+0 }'
}

# Kill the WHOLE tree (killing $CHILD alone leaves orphans — see the exa-child incident above),
# and print the evidence a human would want, so the next incident explains itself.
die() {
  local rc=$1; shift
  echo "$*"
  echo "--- process tree at kill time (CPU/RSS are the hang discriminators) ---"
  ps -o pid,ppid,%cpu,rss,state,etime,command -p "$(echo "$pids" | tr ' ' ',')" 2>/dev/null
  echo "--- client files written in the last 30m ---"
  find "$WATCH_DIR" -type f -mmin -30 2>/dev/null | head -20
  echo "  Salvage before re-dispatching: grep -c secondary clients/<slug>/site/src -r ; ls clients/<slug>/site/out"
  if [ "$rc" -eq 4 ]; then
    echo "  ⚠️ CEILING kill: if the run had reached /deploy or later, VERIFY external side"
    echo "  effects (GHL contact/tags, Vercel alias) before re-dispatching — do not assume clean."
  fi
  kill $pids 2>/dev/null; sleep 2; kill -9 $pids 2>/dev/null
  exit "$rc"
}

started=$(date +%s)
last_write=$started        # last clients/ file write
last_liveness=$started     # last write OR CPU accrual OR tree-shape change
ceiling=$MAX_MIN
pids="$CHILD"; pids_prev=""; cpu_prev=0

# 2026-08-18 (Fable): an OPERATOR kill of this wrapper (Ctrl-C, `kill <wrapper-pid>`) had no trap,
# so unlike every kill path above it neither reaped the child tree nor printed salvage evidence —
# exactly the orphan class the whole-tree kill in die() exists to prevent, just reached from the
# other direction. This makes a deliberate kill (e.g. "kill it" mid-dispatch) a first-class,
# recoverable event: the tree gets reaped and the same salvage summary prints, instead of leaving
# an orphaned claude -p tree and an operator manually hunting pids.
trap 'pids=$(tree_pids "$CHILD"); die 130 "OPERATOR KILL: dispatch-build.sh wrapper received INT/TERM."' INT TERM

while kill -0 "$CHILD" 2>/dev/null; do
  sleep 30
  now=$(date +%s)

  # Signal 1: file writes. Unchanged — and keep -mmin, NEVER -newermt (see note above).
  sig=$(find "$WATCH_DIR" -type f -mmin -2 2>/dev/null | wc -l | tr -d ' ')
  if [ "$sig" != "0" ]; then last_write=$now; last_liveness=$now; fi

  # Signal 2: process-tree CPU. A model composing one huge tool call writes no files for
  # 10+ minutes but the CLI streams tokens the whole time and accrues real CPU. The
  # documented true hang sat at 0% CPU / 56MB RSS — CPU separates the two cases the
  # filesystem cannot. A negative delta means a busy child (e.g. next build) exited: an
  # event, not silence. A changed pid set likewise counts as life.
  pids=$(tree_pids "$CHILD")
  cpu_now=$(tree_cpu_cs "$pids")
  cpu_delta=$(( cpu_now - cpu_prev ))
  if [ "$pids" != "$pids_prev" ] || [ "$cpu_delta" -ge "$CPU_ACTIVE_CS" ] || [ "$cpu_delta" -lt 0 ]; then
    last_liveness=$now
  fi
  cpu_prev=$cpu_now; pids_prev=$pids

  idle=$((  (now - last_liveness) / 60 ))   # dead-quiet: no writes AND no CPU AND static tree
  quiet=$(( (now - last_write)    / 60 ))   # writeless (CPU may still be active = composing)
  total=$(( (now - started)       / 60 ))

  # DEAD: nothing moving anywhere. This is the only state the old stall timer should ever
  # have killed. 16 consecutive silent samples — one quiet moment cannot trip it.
  [ "$idle" -ge "$STALL_MIN" ] && \
    die 3 "HUNG: no file writes and ~0 CPU across the tree for ${idle}m (total ${total}m). Killing."

  # COMPOSING-forever: CPU burning but nothing ever lands. Catches livelock/retry loops
  # that the CPU signal would otherwise wave through indefinitely.
  [ "$quiet" -ge "$QUIET_MAX_MIN" ] && \
    die 5 "SILENT RUNAWAY: CPU active but zero client-file writes for ${quiet}m (total ${total}m). Killing."

  # Backstop: nothing extends past this, however lively.
  [ "$total" -ge "$HARD_MAX_MIN" ] && \
    die 4 "HARD CAP: ${total}m elapsed (cap ${HARD_MAX_MIN}m). Killing."

  # Soft ceiling: never guillotine a run that is demonstrably mid-write — that is how a kill
  # lands mid-/deploy with GHL half-touched. Fire only in a quiet gap; extend otherwise.
  if [ "$total" -ge "$ceiling" ]; then
    if [ "$quiet" -ge 3 ]; then
      die 4 "CEILING: ${total}m elapsed and quiet ${quiet}m. Killing."
    else
      ceiling=$(( total + 10 ))
      echo "ceiling: ${total}m elapsed but actively writing (last write ${quiet}m ago) — extending to ${ceiling}m (hard cap ${HARD_MAX_MIN}m)"
    fi
  fi
done

wait "$CHILD"; rc=$?
echo "child exited rc=$rc after $(( ($(date +%s) - started) / 60 ))m"

# Post-exit sweep (Fable consult, 2026-08-18): qa-reviewer's Call 3 EXIT trap kills its own
# `python3 -m http.server` on the client's QA port, but that trap only fires inside the CHILD
# process's own bash — if the child was killed uncleanly above, or the trap itself failed, a
# server can outlive the whole dispatch. Same phantom-idle shape as the exa-mcp-server incident
# --strict-mcp-config was added for: the work is done, but a lingering process holds resources.
# The command line alone (`python3 -m http.server <port> --directory out`) is generic across every
# client and gives no client-scoped string to pkill -f on, so match by PID's cwd instead (via lsof)
# — that's what actually distinguishes THIS run's server from another concurrent lane's.
REPO_ROOT_ABS="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
for pid in $(pgrep -f "http\.server .* --directory out" 2>/dev/null); do
  cwd=$(lsof -a -d cwd -p "$pid" -Fn 2>/dev/null | sed -n 's/^n//p')
  case "$cwd" in
    "$REPO_ROOT_ABS/$WATCH_DIR"/*/site) kill "$pid" 2>/dev/null && echo "swept lingering QA http.server pid=$pid cwd=$cwd" ;;
  esac
done

exit "$rc"
