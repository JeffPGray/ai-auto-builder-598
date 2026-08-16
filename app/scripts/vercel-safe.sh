#!/bin/bash
# vercel-safe.sh <subcommand...> — every Vercel call in the pipeline goes through this.
#
# WHY. On 2026-08-16 a headless build ran 58 minutes and produced nothing. Its own transcript ends
# mid-response on "Retrieving project… / Loading teams…": **it hung inside the Vercel CLI on a
# network call with no timeout.** The process sat at 0% CPU with 56 MB RSS (a working session holds
# ~750 MB) while the source work it had already finished sat undeployed. Nothing recovered it; a
# human noticed the wall clock.
#
# That is the single biggest obstacle to unattended running: an unbounded network call inside an
# unattended process is an unbounded outage. The same investigation found the child had linked to
# prj_s72W616… — NOT gr-no-website-builds — so it was resolving the WRONG PROJECT when it stalled.
#
# So this wrapper does two things and nothing else:
#   1. HARD TIMEOUT on every invocation. `timeout` does not exist on macOS (its silent absence has
#      already invalidated one test in this project), so use perl's alarm.
#   2. RETRY a bounded number of times, because the failure mode observed is a hang rather than an
#      error — a hung call that is killed and retried usually succeeds on the next attempt.
#
# It deliberately does NOT interpret Vercel's output. Callers do that. This only guarantees the call
# returns.

set -uo pipefail

VERCEL_TIMEOUT="${VERCEL_TIMEOUT:-180}"   # seconds per attempt
VERCEL_TRIES="${VERCEL_TRIES:-3}"

attempt=1
while [ "$attempt" -le "$VERCEL_TRIES" ]; do
  # NOTE: capture BOTH streams. The Vercel CLI writes its human-readable output to STDERR, so
  # `2>/dev/null | grep` silently yields nothing and any `grep -c` on it reports 0 — which once read
  # as "deletion succeeded" immediately after a deletion that had FAILED.
  out=$(perl -e 'alarm shift; exec @ARGV' "$VERCEL_TIMEOUT" npx vercel "$@" 2>&1)
  rc=$?
  printf '%s\n' "$out"

  if [ "$rc" -eq 0 ]; then exit 0; fi

  # 142 = SIGALRM from perl: the hang case, worth retrying.
  if [ "$rc" -eq 142 ]; then
    echo "vercel-safe: attempt ${attempt}/${VERCEL_TRIES} HUNG past ${VERCEL_TIMEOUT}s — killed, retrying" >&2
    attempt=$((attempt + 1))
    continue
  fi

  # A real non-zero exit is a genuine error; retrying it just repeats the error.
  echo "vercel-safe: vercel exited ${rc} (not a hang) — not retrying" >&2
  exit "$rc"
done

echo "vercel-safe: gave up after ${VERCEL_TRIES} hung attempts of ${VERCEL_TIMEOUT}s each" >&2
exit 142
