#!/bin/bash
# run-lane.sh <lane-number> <slug> [slug...]
#
# One build lane: works its slugs SEQUENTIALLY through the full staged pipeline.
# Three of these running concurrently is "3 lanes wide"; the slugs after the first are the depth.
#
# Sequential within a lane is deliberate. dispatch-staged already runs gather/design+build/QA/deploy
# as separate dispatches, and two builds for DIFFERENT clients inside one lane would fight over the
# same qa-serve port and the same playwright session names. Concurrency belongs BETWEEN lanes, where
# each has its own WATCH_DIR, never inside one.
set -uo pipefail

# ── DO NOT COUNT PROCESSES WITH `pgrep -c` ────────────────────────────────────────────────────
# It does not exist on macOS: it prints a usage line to stderr and returns nothing, so
# $(pgrep -cf 'foo') evaluates to 0 — indistinguishable from "not running". On 2026-08-20 that
# reading reported three healthy lanes as dead, a second set of three was launched on top of them,
# and two dispatch-staged processes raced on the same client directory, qa-serve port and
# playwright session names. All nine client dirs had to be wiped.
#
#   ps -Ao command= | grep -c '[r]un-lane.sh'     <- correct; bracket avoids matching self
#
# A lane refuses to start if one is already running for the same slug, because the cost of a
# duplicate is corruption, not just wasted compute.
lane_guard() {
  local slug="$1" n
  # bracket the first char so this grep cannot match its OWN command line — without it the
  # guard sees itself, reports a duplicate, and refuses to start every lane.
  n=$(ps -Ao command= 2>/dev/null | grep -c "[d]ispatch-staged.sh ${slug}" || true)
  if [ "${n:-0}" -gt 0 ]; then
    echo "[lane $LANE] $slug: a dispatch is ALREADY running for this slug — refusing to start a second"
    return 1
  fi
  return 0
}
LANE="$1"; shift
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
mkdir -p logs

for slug in "$@"; do
  ctx="prompts/context/${slug}-context.md"
  if [ ! -f "$ctx" ]; then
    echo "[lane $LANE] $slug: no context brief at $ctx — SKIPPING"; continue
  fi
  lane_guard "$slug" || continue
  # ONE AUTOMATIC RETRY ON A RESUMABLE FAILURE.
  #
  # dispatch-staged stops its loop on any non-zero stage exit, which is right — it must not spin
  # forever on a genuinely broken client. But the failures actually seen are TRANSIENT and the
  # work already done is DURABLE: staged dispatch checkpoints to disk, so a retry resumes at the
  # stage that failed rather than rebuilding from scratch. Measured 2026-08-20, three failures in
  # one campaign, every one of them recoverable by re-running the identical command by hand:
  #   diers-vacuum-service-ms  watchdog killed it on a SIBLING's transcript, after its own gather
  #                            had already completed successfully
  #   diers-vacuum-service-ms  a skill sent it hunting a file that does not exist
  #   aquaklear-ms             ONE throttled rate_limit event -> API stall -> 8m dead-quiet kill
  # Without this the lane parks a healthy client until a human notices, which on an overnight run
  # means the slot is dead until morning. The retry is capped at one: a second identical failure
  # is a real defect and should stay visible rather than burn the lane in a loop.
  attempt=1
  while :; do
    echo "[lane $LANE] === $slug starting (attempt $attempt) $(date -u +%H:%M:%SZ) ==="
    bash scripts/dispatch-staged.sh "$slug" "$ctx" \
      > "logs/lane${LANE}-${slug}-attempt${attempt}-wrapper.log" 2>&1
    rc=$?
    echo "[lane $LANE] === $slug finished rc=$rc (attempt $attempt) $(date -u +%H:%M:%SZ) ==="
    [ "$rc" -eq 0 ] && break
    if [ "$attempt" -ge 2 ]; then
      # A failed client must not take the lane down — the remaining slugs are independent work.
      echo "[lane $LANE] $slug FAILED (rc=$rc) after $attempt attempts — see logs/lane${LANE}-${slug}-attempt${attempt}-wrapper.log, continuing"
      break
    fi
    # Only retry if there is genuinely somewhere to resume FROM. A client with no detectable
    # stage is not a stall, it is a broken client, and re-running it just fails twice as slowly.
    if ! node scripts/detect-resume-stage.mjs "$slug" 2>/dev/null | grep -q '^STAGE='; then
      echo "[lane $LANE] $slug FAILED (rc=$rc) and has no resumable stage — not retrying, continuing"
      break
    fi
    echo "[lane $LANE] $slug rc=$rc — resumable, retrying once after 60s backoff (transient stalls are the common cause)"
    sleep 60
    attempt=$((attempt + 1))
  done
done
echo "[lane $LANE] lane complete $(date -u +%H:%M:%SZ)"
