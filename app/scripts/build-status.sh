#!/bin/bash
# build-status.sh [slug] — is this build working, or actually stuck?
#
# WHY THIS EXISTS. A parent Claude session writes NOTHING to its own transcript for the entire time
# a sub-agent is running. QA runs as a sub-agent and takes 10-16 minutes per round. So from outside,
# a perfectly healthy build looks identical to a dead one: silent process, flat transcript, no new
# client files while the reviewer reads screenshots.
#
# Measured 2026-08-16: the operator read this as a hang on every build since build 3, and it cost
# real attention every time. Twice in one session it also fooled ME — first because `ps | grep
# 'claude -p'` misses the child (it appears as bare `claude`), then because I watched the parent
# transcript while the work was happening in `<session>/subagents/*.jsonl`.
#
# The honest liveness signal is the UNION of three things, because each one alone has a blind spot:
#   1. client files      — blind while QA is only READING screenshots
#   2. parent transcript — blind for the entire duration of any sub-agent
#   3. subagent transcripts — the thing that is actually moving during QA
#
# ⛔ Use -mmin, never `-newermt '<relative>'`. BSD find does not parse relative time strings: it
# returns zero matches AND exit 0, a silent fail-open that made the build watchdog report a stall
# on every healthy build. Measured: ten consecutive `-newermt '5 minutes ago'` returned 0 while
# `-mmin -5` returned 630 on the same tree at the same instant.

set -uo pipefail

SLUG="${1:-}"
APP="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJ="$HOME/.claude/projects/-Users-jeffgray-Github-klaudius-app"
cd "$APP" || exit 1

now=$(date +%s)
age() { echo $(( now - $1 )); }
fmt() { local s=$1; printf '%dm%02ds' $((s/60)) $((s%60)); }

# ── The build process. It appears as bare `claude`, NOT `claude -p` — the flag is not in the
# comm column ps prints here, and grepping for `claude -p` silently finds nothing.
#
# NOTE: no `mapfile`/`readarray` — macOS ships bash 3.2 and both are bash 4+. This script must run
# on the stock shell, so keep it POSIX-ish. (Caught by running it, not by reading it.)
PROCS=$(ps -Ao pid,etime,rss,comm 2>/dev/null | awk '$4=="claude" && $3>100000 {printf "  pid %s   elapsed %s   rss %dMB\n",$1,$2,int($3/1024)}')
if [ -z "$PROCS" ]; then
  echo "BUILD: no working claude process found (rss > 100MB). Nothing is running."
  exit 0
fi

echo "BUILD PROCESSES"
echo "$PROCS"

# ── Client file activity
if [ -n "$SLUG" ] && [ -d "clients/$SLUG" ]; then
  n2=$(find "clients/$SLUG" -type f -mmin -2 2>/dev/null | wc -l | tr -d ' ')
  last=$(find "clients/$SLUG" -type f -not -path '*/node_modules/*' -exec stat -f '%m' {} + 2>/dev/null | sort -rn | head -1)
  echo
  echo "CLIENT FILES ($SLUG)"
  echo "  written in last 2 min : $n2"
  [ -n "${last:-}" ] && echo "  most recent write     : $(fmt "$(age "$last")") ago"
fi

# ── Sub-agent activity. THIS is what moves during QA, and it is the signal both the operator and
# I kept missing.
echo
echo "SUB-AGENTS (QA runs here — the parent goes silent while these work)"
main=$(ls -t "$PROJ"/*.jsonl 2>/dev/null | head -1)
if [ -z "${main:-}" ]; then
  echo "  no session transcript found"
else
  echo "  parent transcript     : $(fmt "$(age "$(stat -f '%m' "$main")")") ago  <- silence here proves NOTHING"
  subdir="${main%.jsonl}/subagents"
  if [ -d "$subdir" ]; then
    newest=0
    for f in "$subdir"/*.jsonl; do
      [ -f "$f" ] || continue
      m=$(stat -f '%m' "$f"); a=$(age "$m")
      [ "$m" -gt "$newest" ] && newest=$m
      kind="QA reviewer"; case "$f" in *acompact*) kind="auto-compaction";; esac
      printf "    %-16s %6s MB   written %s ago\n" "$kind" \
        "$(echo "scale=1; $(stat -f '%z' "$f")/1048576" | bc 2>/dev/null || echo '?')" "$(fmt "$a")"
    done
    [ "$newest" -gt 0 ] && SUB_AGE=$(age "$newest") || SUB_AGE=999999
  else
    echo "    (none)"
    SUB_AGE=999999
  fi
fi

# ── The verdict. Stuck means NOTHING moved anywhere — not files, not the parent, not a sub-agent.
echo
PARENT_AGE=$(age "$(stat -f '%m' "$main" 2>/dev/null || echo "$now")")
FILE_AGE=${last:+$(age "$last")}; FILE_AGE=${FILE_AGE:-999999}
QUIET=$PARENT_AGE
[ "${SUB_AGE:-999999}" -lt "$QUIET" ] && QUIET=$SUB_AGE
[ "$FILE_AGE" -lt "$QUIET" ] && QUIET=$FILE_AGE

if [ "$QUIET" -lt 180 ]; then
  echo "VERDICT: WORKING — something moved $(fmt "$QUIET") ago."
elif [ "$QUIET" -lt 600 ]; then
  echo "VERDICT: probably working. Quietest signal is $(fmt "$QUIET") old."
  echo "  A single long generation or an auto-compaction can be several minutes. Re-run before acting."
else
  echo "VERDICT: ⚠️  STUCK — nothing has moved in $(fmt "$QUIET")."
  echo "  Salvage before killing: the source work is usually complete and only needs build + deploy."
  echo "    ls clients/${SLUG:-<slug>}/site/out/*.html ; cat clients/${SLUG:-<slug>}/data/qa-report.md"
fi
