#!/bin/bash
# Launch via scripts/dispatch-detach.py when Cursor/agent shells kill nohup children.
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
# 2026-08-20: bare "clients" silently skips cost_ledger build-start/end (COST_SLUG empty) AND
# makes stall watch cross-talk across lanes. run-lane / dispatch-staged always pass clients/<slug>.
# Refuse the bare default so a hand-launch cannot burn a Max session with no metering.
if [ "$WATCH_DIR" = "clients" ]; then
  echo "ERROR: pass clients/<slug> as arg 5 (required for cost_ledger + per-lane stall watch)." >&2
  echo "  usage: dispatch-build.sh <prompt> <log> [stall-min] [max-min] clients/<slug>" >&2
  exit 2
fi
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
# DISPATCH_MODEL / DISPATCH_EFFORT (opt-in via env, default unchanged — opus/high, the setting
# every stage used before 2026-08-19). Parameterised so a staged dispatch (scripts/dispatch-staged.sh)
# can run gather and mechanical qa-fix rounds at a cheaper tier while design/build stays opus/high —
# per the 2026-08-19 Fable review: effort is a real per-turn reasoning-token multiplier, and gather
# is mostly checklist-shaped tool-driving, not the design-judgment surface that tier exists to protect.
# --- Per-build cost measurement (scripts/cost_ledger.py) ---------------------------------------
# Klaudius's whole thesis is "~$0 marginal cost per site" — generation runs on a Claude
# subscription, not metered API credit — so the number that decides whether that thesis holds is
# PLAN USAGE PER BUILD. This wrapper is the only place that can honestly measure it.
#
# WHY HERE AND NOWHERE ELSE. `cost_ledger.py build-start` snapshots the session transcripts that
# ALREADY EXIST, and build-end keeps only transcripts that appeared after that snapshot. That is
# what separates this build from the operator's own live conversation and from a sibling lane
# dispatched into the same project dir. A skill invoked INSIDE the build cannot take that
# snapshot — by the time it runs, its own transcript already exists and the baseline is polluted.
# (Measured 2026-08-16, recorded in the script's own docstring: an unscoped 2-second smoke test
# reported 1.29% of plan because eight unrelated sessions were live.)
#
# FAIL-SAFE BY CONSTRUCTION. Cost tracking must never cost a build, so every call is `|| true` and
# nothing here can change the exit status. It only arms when arg 5 scoped WATCH_DIR to a single
# client — the bare "clients" default carries no slug, exactly as die()'s resume detection assumes.
COST_SLUG=""
if [[ "$WATCH_DIR" == clients/* ]]; then
  COST_SLUG="$(basename "$WATCH_DIR")"
  # cost_end() deliberately blanks COST_SLUG to stay idempotent, but the transcript resolver needs
  # the slug for the whole life of the run — keep an unclearable copy for it.
  TX_SLUG="$COST_SLUG"
  python3 scripts/cost_ledger.py build-start "$COST_SLUG" || true
fi

# Close the mark exactly once, whether the child exited on its own or the watchdog killed it.
# An OPENED-AND-NEVER-CLOSED mark is not untidy, it is corrupting: `stages` and `build-end` attribute
# every session newer than the mark to that build. Found 2026-08-19 in data/build-marks.json — two
# stale marks (demolition-okc-rebuild, abacus-plumbing) opened by hand on 2026-08-16 and never
# closed, so `stages abacus-plumbing` today reports 28 sessions and 52.7M weighted tokens, having
# swallowed three days of entirely unrelated work. Closing on the kill paths too is what prevents it.
cost_end() {
  [ -n "$COST_SLUG" ] || return 0
  local _slug="$COST_SLUG"
  COST_SLUG=""                                  # idempotent: never double-close
  python3 scripts/cost_ledger.py build-end "$_slug" --log "$LOG" || true
  # experiment/speed-cut + parallel lanes: surface stage wall + hillards compare at close
  node scripts/stage-timer.mjs show "$_slug" 2>/dev/null || true
  python3 scripts/cost_ledger.py compare "$_slug" 2>/dev/null || true
}

# 2026-08-19 — MEASURED on this box, not reasoned. Trivial 2-turn prompt, bytes-on-disk over time:
#   default (no --output-format) : 0B @2s -> 5B at exit        (the whole output IS the final line)
#   --output-format json         : 0B @2s -> 897B at exit      (single result object, at exit only)
#   --output-format stream-json --verbose : 0B throughout the run -> 33,307B at exit
#
# ⛔ CORRECTED 2026-08-19, SAME DAY. This block previously claimed stream-json writes "25,697B @2s,
# growing continuously mid-run" and was therefore "the only format that leaves evidence when a run
# is killed". BOTH CLAIMS ARE FALSE and the mid-run one does not reproduce. Re-measured twice, with
# a prompt holding a 240-second tool call open so the kill lands mid-flight:
#     t+15s 0B · t+30s 0B · t+45s 0B · t+60s 0B · t+75s 0B · t+90s 0B · AFTER KILL: 0B
# `claude -p` buffers until exit in EVERY output format. No format choice rescues a killed run.
# stream-json stays the default only because it is far richer ON A CLEAN EXIT (33KB vs 897B for
# `json`) — NOT because it helps on a kill. It does not.
#
# The only artifact that IS incremental and DOES survive a kill is the session transcript under
# ~/.claude/projects/<project>/. Measured: the v5 watchdog kill left a 0-byte log and an 873KB /
# 187-line transcript; an operator kill left a 0-byte log and a 3.7MB / 851-line transcript covering
# the full 96 minutes. That is why die() below tails the TRANSCRIPT and not $LOG — tailing a log
# that is guaranteed empty at kill time is how this stayed unobservable for two dead builds.
# It does NOT hang, unlike --mcp-config (the 0-byte-hang hazard documented above).
# --verbose is auto-paired and MUST stay that way: `--output-format stream-json` without it is a
# hard error ("requires --verbose") that kills the dispatch in ~1s with a 74-byte log. Anyone who
# set DISPATCH_OUTPUT_FORMAT=stream-json before today hit exactly that.
# Plain string, NOT a bash array: this runs under `set -u` on macOS bash 3.2, where expanding an
# empty array as "${arr[@]}" is a fatal "unbound variable" — verified, it would break every build.
DISPATCH_OUTPUT_FORMAT="${DISPATCH_OUTPUT_FORMAT:-stream-json}"
VERBOSE_FLAG=""
[ "$DISPATCH_OUTPUT_FORMAT" = "stream-json" ] && VERBOSE_FLAG="--verbose"

# ── PLAYWRIGHT MUST NOT OUTLIVE THE BUILD THAT STARTED IT ────────────────────────────────────
# playwright-cli sessions are GLOBAL per machine and never self-close. Every skill says to close
# the session even on an early abort — but an aborted or watchdog-killed run never REACHES that
# line, which is exactly how they survive. Measured 2026-08-20: four orphaned session daemons
# (`herocheck`, `qa-the-woodlands-plumbing-and-air`, `qa-cfa`, `qa-cfa2`) had been alive for up to
# 3 days 18 hours, holding ~5.9 GB across 98 processes on a machine that is meant to run builds
# back to back. At volume that eats the box in a day or two.
#
# `ps -o etimes=` is NOT supported on macOS — it silently prints the field list instead of a
# number, which is the same class of BSD parsing trap that has already produced two false
# "healthy/stalled" readings in this project. Parse `etime` explicitly.
pw_age_secs() {
  ps -o etime= -p "$1" 2>/dev/null | tr -d ' ' | awk -F'[-:]' '{
    if (NF==4) print $1*86400+$2*3600+$3*60+$4;
    else if (NF==3) print $1*3600+$2*60+$3;
    else if (NF==2) print $1*60+$2; else print 0 }'
}

# Kill any session daemon older than this run could ever legitimately be. Nothing outlives the
# hard cap, so anything past it belongs to a run that is already dead.
pw_sweep_stale() {
  local cap=$(( (HARD_MAX_MIN + 15) * 60 )) killed=0 age
  for pw in $(pgrep -f 'cliDaemon.js' 2>/dev/null); do
    age=$(pw_age_secs "$pw")
    if [ "${age:-0}" -gt "$cap" ]; then
      pkill -P "$pw" 2>/dev/null; kill -9 "$pw" 2>/dev/null; killed=$((killed+1))
    fi
  done
  [ "$killed" -gt 0 ] && echo "swept $killed stale playwright session(s) older than $((cap/60))m"
  return 0
}
pw_sweep_stale

env -u CLAUDECODE -u CLAUDE_CODE CLAUDE_WORKER_CHILD=1 \
  claude -p --permission-mode dontAsk --model "${DISPATCH_MODEL:-opus}" --effort "${DISPATCH_EFFORT:-high}" --strict-mcp-config \
  --output-format "$DISPATCH_OUTPUT_FORMAT" $VERBOSE_FLAG \
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
  # THE ONLY DIAGNOSTIC THAT EXISTS AT KILL TIME. $LOG is guaranteed 0 bytes here (claude -p buffers
  # until exit in every format — measured, see the block above), so the last thing the child actually
  # did is recoverable ONLY from its session transcript, which IS written incrementally.
  echo "--- last activity from the child's session transcript (the log is empty by construction) ---"
  local _proj="$HOME/.claude/projects/$(pwd | sed -e 's#/#-#g' -e 's#\.#-#g')"
  local _tx
  _tx="$(ls -t "$_proj"/*.jsonl 2>/dev/null | head -1)"
  if [ -n "$_tx" ]; then
    echo "  transcript: $_tx ($(wc -c < "$_tx" | tr -d ' ') bytes)"
    python3 - "$_tx" <<'PY' 2>/dev/null || echo "  (could not decode transcript)"
import json,sys
rows=[]
for ln in open(sys.argv[1],encoding="utf-8",errors="replace"):
    ln=ln.strip()
    if not ln.startswith("{"): continue
    try: d=json.loads(ln)
    except Exception: continue
    for c in (d.get("message",{}).get("content") or []):
        if isinstance(c,dict) and c.get("type")=="tool_use":
            rows.append((c.get("name",""), str(c.get("input",{}))[:120]))
for n,i in rows[-8:]:
    print(f"  [tool] {n}: {i}")
print(f"  ({len(rows)} tool calls total; the LAST one is where it stopped)")
PY
  else
    echo "  no transcript found under $_proj"
  fi
  echo "  Salvage before re-dispatching: grep -c secondary clients/<slug>/site/src -r ; ls clients/<slug>/site/out"
  if [ "$rc" -eq 4 ]; then
    echo "  ⚠️ CEILING kill: if the run had reached /deploy or later, VERIFY external side"
    echo "  effects (GHL contact/tags, Vercel alias) before re-dispatching — do not assume clean."
  fi
  # P1 (2026-08-19 Fable review): a killed dispatch used to mean re-deriving by hand which stages
  # had actually completed before re-dispatching from scratch — that manual reconstruction is what
  # turned three kills tonight into ~3h15m of dead wall-clock. Auto-detect the resumable stage from
  # the checkpoint artifacts (gathered-content.md / design-system.md / VERIFY_GATES_OK_AT /
  # qa-report.md) so re-dispatching starts from the real boundary, not from zero.
  # Computed locally, not via the script-global REPO_ROOT_ABS: that variable is assigned AFTER
  # the watchdog loop that calls die() (see the post-exit sweep further down), so it is still
  # unset the first time die() actually fires. die() needs its own root, independent of when the
  # rest of the script initialises that variable.
  local _die_root; _die_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  local _client_slug; _client_slug="$(basename "$WATCH_DIR")"
  # WATCH_DIR defaults to bare "clients" (arg 5 is optional per the usage string), which makes
  # basename yield "clients" itself, not a real slug (code-review finding, 2026-08-19) — only run
  # detection when WATCH_DIR is actually scoped to one client (clients/<slug>), which is what every
  # real dispatch (single-shot or staged) passes as arg 5.
  if [[ "$WATCH_DIR" == clients/* ]] && [ -f "$_die_root/scripts/detect-resume-stage.mjs" ]; then
    echo "--- resume-stage detection ---"
    (cd "$_die_root" && node scripts/detect-resume-stage.mjs "$_client_slug" 2>&1) || echo "  (resume-stage detection failed — fall back to manual salvage above)"
  fi
  # 2026-08-19: at kill time the log used to be 0 bytes, so die() could show the process tree and
  # CPU but nothing about what the BUILD was doing. The child now streams stream-json continuously;
  # decode its tail into the discriminator the operator actually needs: hung TOOL vs stalled API vs
  # startup hang. Never fatal — a diagnostic that throws during an incident is worse than none.
  echo "--- dispatch log: what the build was doing when it went quiet ---"
  node "$_die_root/scripts/summarize-dispatch-log.mjs" "$LOG" 16 2>&1 || echo "  (summarize failed — raw log at $LOG)"
  live_write "KILLED" 2>/dev/null
  kill $pids 2>/dev/null; sleep 2; kill -9 $pids 2>/dev/null
  # After the tree is reaped, so the transcript being measured is final rather than mid-write.
  cost_end
  exit "$rc"
}

started=$(date +%s)
last_write=$started        # last clients/ file write
last_liveness=$started     # last write OR CPU accrual OR tree-shape change
ceiling=$MAX_MIN
pids="$CHILD"; pids_prev=""; cpu_prev=0

# ── LIVE LEDGER (2026-08-20, Fable design) ─────────────────────────────────────────────────
# "update?" used to cost a 3-command pull: build-status.sh (ps+mtimes), build-metrics.mjs (a FULL
# re-parse of the multi-MB session transcript, every single call, to get compaction count), often
# also run-gates.mjs. This makes the compaction count and current stage available in ONE cheap
# read: `cat data/live/<slug>.json`. It is ephemeral scratch state, not a durable record — the
# transcript stays authoritative; this is a cache the watchdog keeps warm since it is already
# awake every 30s regardless. NOT folded into build-marks.json: that file is Python-owned,
# read-modify-written at build-start/build-end by cost_ledger.py, and popped at build-end — a
# second writer touching it every 30s would race that rewrite and pollute its archive semantics.
mkdir -p "$(dirname "${BASH_SOURCE[0]}")/../data/live"
LIVE_SLUG="$(basename "$WATCH_DIR")"
LIVE_FILE="$(dirname "${BASH_SOURCE[0]}")/../data/live/${LIVE_SLUG}.json"
# Dots too: Claude encodes klaudius/.worktrees → klaudius--worktrees (2026-08-21).
LIVE_PROJ="$HOME/.claude/projects/$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd | sed -e 's#/#-#g' -e 's#\.#-#g')"
# Resolve the build's OWN transcript once: the newest transcript NOT in build-start's "seen"
# snapshot for this slug — the same set cost_ledger.py's build-end uses to isolate this build's
# tokens from concurrent sessions. If no mark was armed (a manual dispatch that skipped
# build-start), fall back to "newest transcript" — best-effort, not authoritative.
# BUG FOUND 2026-08-20, live: this used to resolve ONCE here, before the child had created its
# transcript. At that instant every existing transcript is already in build-start's "seen" set, so
# the exclusion below yields EMPTY and the old `[ -z "$LIVE_TX" ] && ...newest overall` fallback
# then picked the PREVIOUS run's transcript — the one thing it was written to exclude. Result: the
# ledger reported the previous build's totals for the whole of the next build. Measured: a fresh
# 2-minute run reported "compactions=9, transcript_mb=3" (the prior killed run's numbers) while its
# own transcript held 0 compactions and 152 KB. That also means any "0 compactions" read off this
# ledger BEFORE this fix was measured against the wrong file and is not evidence of anything.
#
# Resolved lazily instead, by TIME: the build's own transcript is the newest one whose FIRST event
# is at or after this wrapper started. Nothing else can satisfy that. Re-tried each poll until it
# appears (a few seconds), then locked. mtime is deliberately not the test — a concurrent session
# appending to an older transcript would beat the real one on mtime. EARLIEST qualifying, not
# newest: under parallel builds a run that starts after ours also satisfies ">= started", and
# taking the newest would let it steal our identity. But EARLIEST-AFTER is not enough either:
# our own transcript is created minutes after we dispatch, so a sibling starting inside that gap
# is earlier than ours and steals our identity anyway. Measured 2026-08-20: laceys-digging-ms
# and diers-vacuum-service-ms dispatched in the same second, and this resolver handed one of
# them the OTHER's transcript -- the watchdog then read a sibling's pending tool call as its
# own and killed a build that had already finished its stage successfully. So the test is
# OWNERSHIP (does this transcript name our client?), with earliest-after only as the tiebreak.
LIVE_TX=""
resolve_live_tx() {
  [ -n "$LIVE_TX" ] && return 0
  LIVE_TX="$(python3 -c "
import glob, json, os, sys, datetime
started = float('$started')
slug = '$TX_SLUG'

def owns(path):
    # OWNERSHIP, not proximity. Every dispatch names its client directory in its opening prompt,
    # so the transcript itself says whose it is - decidable from the head, no new CLI flag needed.
    # Read a bounded prefix: these files reach megabytes and this runs on every poll.
    if not slug:
        return True
    try:
        with open(path, errors='replace') as fh:
            for i, line in enumerate(fh):
                if i >= 400:
                    break
                if 'clients/' + slug in line:
                    return True
    except Exception:
        pass
    return False

cands = []
for p in glob.glob('$LIVE_PROJ/*.jsonl'):
    try:
        if os.path.getmtime(p) < started - 5:
            continue
        with open(p) as fh:
            for line in fh:
                try: ts = json.loads(line).get('timestamp')
                except Exception: continue
                if not ts: continue
                t = datetime.datetime.fromisoformat(ts.replace('Z', '+00:00')).timestamp()
                if t >= started - 5:
                    cands.append((t, p))
                break
    except Exception:
        continue
cands.sort()
# Prefer the earliest transcript THAT NAMES THIS CLIENT. Falling back to the earliest of any is
# the old behaviour, kept only for a dispatch with no slug (WATCH_DIR not under clients/).
mine = next((p for t, p in cands if owns(p)), None)
print(mine or (cands[0][1] if cands else ''))" 2>/dev/null)"
  [ -n "$LIVE_TX" ]
}
LIVE_OFFSET=0
LIVE_COMPACTIONS=0
LIVE_STAGE="unknown"

# Rewrite the live-ledger file. $1 = state label (ACTIVE/COMPOSING/QUIET/DEAD/DONE/KILLED).
# Cheap: one small JSON object, overwritten (not appended) every call.
live_write() {
  local state="$1" tx_mb=0
  [ -n "$LIVE_TX" ] && [ -f "$LIVE_TX" ] && tx_mb=$(( $(wc -c < "$LIVE_TX" 2>/dev/null | tr -d ' ') / 1048576 ))
  cat > "$LIVE_FILE" <<JSON
{
  "slug": "$LIVE_SLUG",
  "pid": $CHILD,
  "state": "$state",
  "elapsed_min": ${total:-0},
  "last_write_min": ${quiet:-0},
  "compactions": $LIVE_COMPACTIONS,
  "compactions_target": "<3",
  "stage": "$LIVE_STAGE",
  "transcript_mb": $tx_mb,
  "updated": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON
}
live_write "STARTING"

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

  # Signal 1: meaningful file writes. Keep -mmin, NEVER -newermt.
  # Exclude build artefacts: site/out + .next churn after `next build` / static export and will
  # keep the soft ceiling extending forever after the model is done (measured bluegrass-blast-pw
  # 2026-08-20 on experiment/speed-cut: final summary already printed, ceiling extended 90→140m
  # on "last write 0m ago" driven by out/ artefacts — the parallel 3-lane stack hits the same
  # shape after /deploy). node_modules/.git are noise for the same reason.
  sig=$(find "$WATCH_DIR" -type f -mmin -2     ! -path '*/node_modules/*' ! -path '*/.next/*' ! -path '*/site/out/*'     ! -path '*/.git/*' 2>/dev/null | wc -l | tr -d ' ')
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

  # Live ledger: incremental tail parse, KB not MB. Reads only the bytes written since the last
  # poll (tracked by LIVE_OFFSET), so cost stays flat as the transcript grows instead of the full
  # re-parse build-metrics.mjs does on every call. Counts the same "isCompactSummary":true marker
  # build-metrics.mjs uses (its own parent-vs-subagent comparison on cold-front-ac found the PARENT
  # marker is the authoritative one — 9 vs 3 — so this deliberately only reads $LIVE_TX, never a
  # subagents/ file), so the two numbers agree.
  resolve_live_tx || true
  if [ -n "$LIVE_TX" ] && [ -f "$LIVE_TX" ]; then
    live_cur=$(wc -c < "$LIVE_TX" 2>/dev/null | tr -d ' ')
    live_cur=${live_cur:-0}
    if [ "$live_cur" -gt "$LIVE_OFFSET" ]; then
      live_chunk=$(tail -c "+$((LIVE_OFFSET + 1))" "$LIVE_TX" 2>/dev/null)
      live_new=$(printf '%s' "$live_chunk" | grep -c '"isCompactSummary":true')
      LIVE_COMPACTIONS=$((LIVE_COMPACTIONS + live_new))
      live_skill=$(printf '%s' "$live_chunk" | grep -o '"name":"Skill"[^}]*"skill":"[a-z-]*"' | tail -1 | sed -E 's/.*"skill":"([a-z-]*)".*/\1/')
      [ -n "$live_skill" ] && LIVE_STAGE="$live_skill"
      LIVE_OFFSET=$live_cur
    fi
  fi
  live_state="QUIET"
  [ "$sig" != "0" ] && live_state="ACTIVE"
  [ "$sig" = "0" ] && [ "$cpu_delta" -ge "$CPU_ACTIVE_CS" ] && live_state="COMPOSING"
  live_write "$live_state"

  # DEAD: nothing moving anywhere. This is the only state the old stall timer should ever
  # have killed. 16 consecutive silent samples — one quiet moment cannot trip it.
  # ⚠️ A CHILD THAT HAS ALREADY FINISHED LOOKS EXACTLY LIKE A HUNG ONE. No writes, ~0 CPU, static
  # tree — that is equally the signature of "done, tearing down" and of "wedged".
  #
  # BUG FOUND 2026-08-20, and it cost a completed run its deploy. The QA stage emitted its terminal
  # result event (`"type":"result","subtype":"success"`), then idled during teardown; at 8 idle
  # minutes this branch killed it, dispatch-build exited non-zero, and dispatch-staged stopped the
  # loop ONE STAGE SHORT of /deploy. QA had PASSED. The site was built, verified and reviewed, and
  # never went live. The wrapper's own summariser printed "child reached a result event (success) —
  # it COMPLETED its turn" immediately after the kill, which is the whole diagnosis sitting one
  # line below the mistake.
  #
  # So: ask the transcript before killing. The transcript is written LIVE (unlike $LOG, which
  # claude -p buffers until exit), so a terminal result event is visible in it the moment it
  # happens. If one is there, the child is DONE, not hung — stop watching and let `wait` collect it
  # normally. Only kill when the silence is unexplained.
  if [ "$idle" -ge "$STALL_MIN" ]; then
    resolve_live_tx || true
    # NOT a grep for '"type":"result"' — that marker lives in the stream-json LOG, which claude -p
    # buffers until exit, so it is provably absent from the transcript at kill time (verified
    # directly against the killed QA run's own transcript: 0 occurrences). The transcript's real
    # completion signal is whether a TOOL CALL IS STILL OUTSTANDING:
    #   last assistant message issued a tool_use with no matching tool_result  -> a tool is stuck,
    #     the agent is genuinely blocked on it. That is the hang this watchdog exists to kill.
    #   last assistant message is text-only (no pending tool_use)              -> the turn ENDED.
    #     Nothing is outstanding; the silence is teardown, not a wedge.
    # Verified against the killed run: its final record was a text-only assistant message.
    tstate=""
    if [ -n "$LIVE_TX" ] && [ -f "$LIVE_TX" ]; then
      tstate=$(python3 - "$LIVE_TX" <<'PYEOF' 2>/dev/null
import sys, json
pending = set(); last_assistant_had_tools = None
try:
    with open(sys.argv[1]) as fh:
        for line in fh:
            try: d = json.loads(line)
            except Exception: continue
            m = d.get('message') or {}
            content = m.get('content')
            if not isinstance(content, list): continue
            if m.get('role') == 'assistant':
                ids = [c['id'] for c in content
                       if isinstance(c, dict) and c.get('type') == 'tool_use' and c.get('id')]
                if ids:
                    pending.update(ids); last_assistant_had_tools = True
                elif any(isinstance(c, dict) and c.get('type') == 'text' for c in content):
                    last_assistant_had_tools = False
            elif m.get('role') == 'user':
                for c in content:
                    if isinstance(c, dict) and c.get('type') == 'tool_result':
                        pending.discard(c.get('tool_use_id'))
    print('COMPLETED' if (not pending and last_assistant_had_tools is False) else 'PENDING')
except Exception:
    print('UNKNOWN')
PYEOF
)
    fi
    if [ "$tstate" = "COMPLETED" ]; then
      echo "idle ${idle}m, but the transcript's last assistant message is a text-only answer with no outstanding tool call — child COMPLETED its turn, not hung; waiting for it to exit cleanly"
      COMPLETED_GRACE=1
      break
    fi
    die 3 "HUNG: no file writes and ~0 CPU across the tree for ${idle}m (total ${total}m). Killing."
  fi

  # COMPOSING-forever: CPU burning but nothing ever lands. Catches livelock/retry loops
  # that the CPU signal would otherwise wave through indefinitely.
  [ "$quiet" -ge "$QUIET_MAX_MIN" ] && \
    die 5 "SILENT RUNAWAY: CPU active but zero client-file writes for ${quiet}m (total ${total}m). Killing."

  # Backstop: nothing extends past this, however lively.
  [ "$total" -ge "$HARD_MAX_MIN" ] && \
    die 4 "HARD CAP: ${total}m elapsed (cap ${HARD_MAX_MIN}m). Killing."

  # Soft ceiling: never guillotine a run that is demonstrably mid-write — that is how a kill
  # lands mid-/deploy with GHL half-touched. Fire only in a quiet gap; extend otherwise.
  # 2026-08-20: if the transcript already shows a COMPLETED turn, do NOT extend — that is the
  # post-deploy / post-STOPPED `claude -p` teardown hang (aaa/laceys/aquaklear/bluegrass). Enter
  # the bounded grace path instead of riding artefact writes up to HARD_MAX.
  if [ "$total" -ge "$ceiling" ]; then
    resolve_live_tx || true
    tstate=""
    if [ -n "$LIVE_TX" ] && [ -f "$LIVE_TX" ]; then
      tstate=$(python3 - "$LIVE_TX" <<'PYEOF' 2>/dev/null
import sys, json
pending = set(); last_assistant_had_tools = None
try:
    with open(sys.argv[1]) as fh:
        for line in fh:
            try: d = json.loads(line)
            except Exception: continue
            m = d.get('message') or {}
            content = m.get('content')
            if not isinstance(content, list): continue
            if m.get('role') == 'assistant':
                ids = [c['id'] for c in content
                       if isinstance(c, dict) and c.get('type') == 'tool_use' and c.get('id')]
                if ids:
                    pending.update(ids); last_assistant_had_tools = True
                elif any(isinstance(c, dict) and c.get('type') == 'text' for c in content):
                    last_assistant_had_tools = False
            elif m.get('role') == 'user':
                for c in content:
                    if isinstance(c, dict) and c.get('type') == 'tool_result':
                        pending.discard(c.get('tool_use_id'))
    print('COMPLETED' if (not pending and last_assistant_had_tools is False) else 'PENDING')
except Exception:
    print('UNKNOWN')
PYEOF
)
    fi
    if [ "$tstate" = "COMPLETED" ]; then
      echo "ceiling: ${total}m but transcript COMPLETED — entering exit grace (not extending)"
      COMPLETED_GRACE=1
      break
    fi
    if [ "$quiet" -ge 3 ]; then
      die 4 "CEILING: ${total}m elapsed and quiet ${quiet}m. Killing."
    else
      ceiling=$(( total + 10 ))
      echo "ceiling: ${total}m elapsed but actively writing (last write ${quiet}m ago) — extending to ${ceiling}m (hard cap ${HARD_MAX_MIN}m)"
    fi
  fi
done

# BOUNDED grace period, not an unconditional wait. A COMPLETED turn (text-only final message,
# no outstanding tool call) means the MODEL is done, but `claude -p` itself does not always exit
# on its own after that -- confirmed live 2026-08-20 on three separate builds (aaa-septic-systems-ms,
# laceys-digging-ms, aquaklear-ms), each of which had genuinely passed QA and then sat with a
# text-only final transcript message for 40-90 real minutes while `wait "$CHILD"` blocked here
# forever with nothing to time it out. Killing the orphaned qa-serve.mjs Node server each child had
# spawned (the obvious first suspect) did NOT free it -- the process stayed at ~0% CPU, static, for
# over an hour -- so this is a `claude -p` exit-path hang, not a job-control/orphan-child issue this
# script can prevent at the source. It CAN bound the cost: if a COMPLETED child has not actually
# exited within GRACE_SEC of being recognised as done, stop trusting it will and reap it directly.
GRACE_SEC=120
if [ "${COMPLETED_GRACE:-0}" = "1" ]; then
  waited=0
  while kill -0 "$CHILD" 2>/dev/null && [ "$waited" -lt "$GRACE_SEC" ]; do
    sleep 5; waited=$((waited + 5))
  done
  if kill -0 "$CHILD" 2>/dev/null; then
    echo "child completed its turn but did not exit within ${GRACE_SEC}s of grace -- forcing it"
    kill -TERM "$CHILD" 2>/dev/null
    sleep 5
    kill -0 "$CHILD" 2>/dev/null && kill -KILL "$CHILD" 2>/dev/null
  fi
fi
wait "$CHILD" 2>/dev/null; rc=$?
total=$(( ($(date +%s) - started) / 60 ))
live_write "DONE(rc=$rc)" 2>/dev/null
echo "child exited rc=$rc after ${total}m"

# The log is stream-json now, which is machine-shaped. Render the human summary (final result text,
# real cost/duration, any rate-limit events) so a SUCCESSFUL run stays as readable as the plain-text
# log it replaced — the format change must not cost the operator legibility. Root computed inline:
# REPO_ROOT_ABS is not assigned until the post-exit sweep below.
echo "--- dispatch summary ---"
node "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/summarize-dispatch-log.mjs" "$LOG" 8 2>&1 || true
cost_end

# Post-exit sweep (Fable consult, 2026-08-18): qa-reviewer's Call 3 EXIT trap kills its own
# `python3 -m http.server` on the client's QA port, but that trap only fires inside the CHILD
# process's own bash — if the child was killed uncleanly above, or the trap itself failed, a
# server can outlive the whole dispatch. Same phantom-idle shape as the exa-mcp-server incident
# --strict-mcp-config was added for: the work is done, but a lingering process holds resources.
# The command line alone (`python3 -m http.server <port> --directory out`) is generic across every
# client and gives no client-scoped string to pkill -f on, so match by PID's cwd instead (via lsof)
# — that's what actually distinguishes THIS run's server from another concurrent lane's.
#
# TWO server shapes are swept, not one. qa-capture.sh now kills Call 2's `python3 -m http.server`
# and binds `node scripts/qa-serve.mjs` in its place (http.server 404s every assetPrefixed asset,
# so the page never hydrates and every browser gate measures a dead page). Both can therefore be
# alive when a dispatch dies uncleanly, and a sweeper that only knows the old pattern would leave
# the new one running forever. qa-serve is launched with cwd = clients/<slug>/site, exactly like
# the server it replaced, so the same cwd test distinguishes this lane's from a concurrent lane's.
REPO_ROOT_ABS="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
for pid in $(pgrep -f "http\.server .* --directory out" 2>/dev/null; pgrep -f "qa-serve\.mjs" 2>/dev/null); do
  cwd=$(lsof -a -d cwd -p "$pid" -Fn 2>/dev/null | sed -n 's/^n//p')
  case "$cwd" in
    "$REPO_ROOT_ABS/$WATCH_DIR"/*/site) kill "$pid" 2>/dev/null && echo "swept lingering QA server pid=$pid cwd=$cwd" ;;
  esac
done

# Operator rule, 2026-08-20: "playwright has to stop when builds stop." When this was the last
# dispatch running, a surviving browser is orphaned BY DEFINITION — no build exists to own it —
# so sweep every session daemon. Guarded on there being no other dispatch wrapper alive, which is
# what makes it safe under concurrent lanes: a parallel build keeps its own session.
sleep 1
if [ -z "$(pgrep -f 'dispatch-(staged|build)\.sh' | grep -v "^$$\$")" ]; then
  pw_left=$(pgrep -f 'cliDaemon.js' 2>/dev/null | wc -l | tr -d ' ')
  if [ "${pw_left:-0}" -gt 0 ]; then
    for pw in $(pgrep -f 'cliDaemon.js' 2>/dev/null); do
      pkill -P "$pw" 2>/dev/null; kill -9 "$pw" 2>/dev/null
    done
    echo "no dispatch left running — swept $pw_left orphaned playwright session(s)"
  fi
fi

exit "$rc"
