#!/usr/bin/env bash
# supervise-campaign.sh <slug> [slug...]
#
# Keeps a campaign full without a human in the loop.
#
# WHY THIS EXISTS. dispatch-staged stops its loop on any non-zero stage exit, which is correct --
# it must not spin on a broken client. But every failure this campaign actually produced was
# TRANSIENT with DURABLE work behind it: a watchdog reading a sibling's transcript, a skill hunting
# a file that does not exist, one throttled rate_limit event, and an in-place edit to a running
# script. In each case re-running the identical command resumed from the last checkpoint. Until now
# the thing re-running it was a person noticing, which on an overnight run means a dead slot until
# morning.
#
# Guards, because an unsupervised re-dispatcher is how you get duplicate builds on one client:
#   - never starts a slug that already has a live dispatch (run-lane's own lane_guard repeats this)
#   - never exceeds MAX_CONC concurrent dispatches
#   - caps attempts per slug, so a genuinely broken client stays visible instead of looping forever
#   - stops entirely once every slug is DEPLOYED
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
MAX_CONC="${MAX_CONC:-5}"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-3}"
SLUGS=("$@")
lane=100
while :; do
  done_all=1
  live=$(ps -Ao command= 2>/dev/null | grep -c '[d]ispatch-staged.sh' || true)
  for slug in "${SLUGS[@]}"; do
    stage=$(node scripts/detect-resume-stage.mjs "$slug" 2>/dev/null | grep '^STAGE=' | cut -d= -f2)
    [ "$stage" = "DEPLOYED" ] && continue
    done_all=0
    # already being worked?
    if ps -Ao command= 2>/dev/null | grep -q "[d]ispatch-staged.sh ${slug}"; then continue; fi
    [ "${live:-0}" -ge "$MAX_CONC" ] && continue
    n=$(cat "data/.supervise-${slug}.n" 2>/dev/null || echo 0)
    if [ "$n" -ge "$MAX_ATTEMPTS" ]; then continue; fi
    # a slug with no detectable stage has nothing to resume from -- that is a broken client
    [ -z "$stage" ] && continue
    echo "$((n+1))" > "data/.supervise-${slug}.n"
    lane=$((lane+1))
    echo "[supervisor] $(date -u +%H:%M:%SZ) re-dispatching $slug at $stage (attempt $((n+1))/$MAX_ATTEMPTS, lane $lane)"
    nohup bash scripts/run-lane.sh "$lane" "$slug" > "logs/lane${lane}.log" 2>&1 &
    live=$((live+1))
    sleep 5
    # A REFUSED start must not cost a real attempt. The supervisor's own "already running" check
    # above has a genuine race window (a ps snapshot vs. a process that started a moment earlier
    # in the same pass) -- caught live 2026-08-20: aaa-septic-systems-ms, which had been running
    # for over an hour, was re-dispatched anyway. run-lane's OWN lane_guard is the authoritative
    # check and correctly refused it, but the attempt counter had already been incremented before
    # that refusal was known. Three of those in a row would bench a build that never actually
    # failed. Roll the counter back when the lane log shows the refusal.
    if grep -q 'a dispatch is ALREADY running for this slug' "logs/lane${lane}.log" 2>/dev/null; then
      echo "$n" > "data/.supervise-${slug}.n"
      echo "[supervisor] $slug: that dispatch was refused as a duplicate, not a real attempt -- attempt counter rolled back to $n"
    fi
  done
  if [ "$done_all" -eq 1 ]; then echo "[supervisor] all slugs DEPLOYED $(date -u +%H:%M:%SZ)"; break; fi
  sleep 120
done
