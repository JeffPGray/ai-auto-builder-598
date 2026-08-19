#!/usr/bin/env bash
# dispatch-staged.sh <client-slug> <base-context-file> [stall-min] [soft-ceiling-min]
#
# P2 of the 2026-08-19 Fable architecture review: instead of one opus/high dispatch for the whole
# pipeline (gather -> design -> build -> QA -> deploy), run each stage as its OWN dispatch, at the
# model tier that stage actually needs. Gather is mostly checklist-shaped tool-driving (screening
# candidates, running scrapers, following a fixed coverage checklist) -- it is already trusted at
# sonnet elsewhere in this repo (qa-reviewer.md's own frontmatter is `model: sonnet`, and Jeff
# approved sonnet for blog prose on 2026-08-18). Design decisions and page authoring stay opus/high
# -- that is the judgment surface the 2026-08-16 "4/10, gates all passed" incident proved cannot be
# cheapened. This is the ONLY tonight's-fixes lever that reduces actual token/quota draw rather than
# just rearranging wall-clock.
#
# This is a FIRST CUT -- validate it on the next fresh client, do not retrofit it onto a dispatch
# already running under the old single-shot model (scripts/dispatch-build.sh unchanged, still works
# standalone for that).
#
# Stage -> model/effort tiering:
#   PRE_GATHER / POST_GATHER (gather stage)          -> sonnet / medium
#   POST_DESIGN_PRE_VERIFY (design + build stage)    -> opus / high   (unchanged, judgment-heavy)
#   POST_VERIFY_* (QA loop)                          -> sonnet / high (matches qa-reviewer.md's own tier;
#                                                        escalate manually to opus if a round's findings
#                                                        are design/content judgment calls, not mechanical)
#   POST_QA_PRE_DEPLOY (deploy)                      -> sonnet / medium (tool-driving: vercel CLI, curl checks)
set -euo pipefail

SLUG="$1"
BASE_CONTEXT_FILE="$2"
STALL_MIN="${3:-8}"
MAX_MIN="${4:-90}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

LOG_DIR="logs"
mkdir -p "$LOG_DIR"

STAGE_COUNT=0
MAX_STAGES=8   # hard backstop: gather, build, up to 3 qa-fix rounds, deploy, plus slack -- never loop forever

while [ "$STAGE_COUNT" -lt "$MAX_STAGES" ]; do
  STAGE_COUNT=$((STAGE_COUNT + 1))

  DETECT_OUT="$(node scripts/detect-resume-stage.mjs "$SLUG")"
  STAGE="$(echo "$DETECT_OUT" | grep '^STAGE=' | cut -d= -f2)"
  echo "=== dispatch-staged: iteration $STAGE_COUNT, detected stage $STAGE ==="

  if [ "$STAGE" = "DEPLOYED" ]; then
    echo "dispatch-staged: client is deployed. Done."
    exit 0
  fi

  case "$STAGE" in
    PRE_GATHER|POST_GATHER)
      MODEL=sonnet; EFFORT=medium
      STAGE_PROMPT_SUFFIX="Run ONLY the /gather step for this client (and /find first if the client is not yet claimed -- check status before assuming). Stop once gathered-content.md is written and looks complete against the coverage checklist. Do NOT run /ui-ux-pro-max, /build, QA, or /deploy in this dispatch -- a separate dispatch handles those at a different model tier." ;;
    POST_DESIGN_PRE_VERIFY)
      MODEL=opus; EFFORT=high
      STAGE_PROMPT_SUFFIX="gather is already complete (see clients/$SLUG/data/gathered-content.md -- do NOT re-run /gather). Run /ui-ux-pro-max then /build for this client. Stop once build's Verify step has genuinely passed (VERIFY_GATES_OK_AT written to status.md) or self-fixed to a clean pass. Do NOT run the QA loop or /deploy in this dispatch." ;;
    POST_VERIFY_PRE_QA|POST_VERIFY_QA_FAILED)
      MODEL=sonnet; EFFORT=high
      STAGE_PROMPT_SUFFIX="gather, design, and build+Verify are ALL already complete -- do NOT re-run any of them. Run the QA loop (spawn qa-reviewer, apply qa-fix on FAIL, re-review) per CLAUDE.md's QA Loop section, up to its normal 3-round max. Stop once QA reaches a PASS verdict or the 3-round max. Do NOT run /deploy in this dispatch. If a QA round's findings are genuinely design or content-judgment calls (not mechanical fixes like dashes/img-dims/typos), say so explicitly in status.md -- a human should consider re-dispatching that round at opus/high instead of continuing at this tier." ;;
    POST_QA_PRE_DEPLOY)
      MODEL=sonnet; EFFORT=medium
      STAGE_PROMPT_SUFFIX="gather, design, build, and QA (PASS) are ALL already complete -- do NOT re-run any of them. Run /deploy for this client and confirm the live URL serves 200." ;;
    *)
      echo "dispatch-staged: unhandled/unexpected stage '$STAGE' -- refusing to guess, stopping." >&2
      exit 1 ;;
  esac

  STAGE_PROMPT_FILE="clients/$SLUG/data/.stage-prompt-$STAGE_COUNT.md"
  { cat "$BASE_CONTEXT_FILE"; echo; echo "## Stage scope for THIS dispatch only"; echo "$STAGE_PROMPT_SUFFIX"; } > "$STAGE_PROMPT_FILE"

  STAGE_LOG="$LOG_DIR/${SLUG}-stage${STAGE_COUNT}-${STAGE}.log"
  echo "dispatching stage $STAGE at model=$MODEL effort=$EFFORT -> $STAGE_LOG"

  DISPATCH_MODEL="$MODEL" DISPATCH_EFFORT="$EFFORT" \
    bash scripts/dispatch-build.sh "$STAGE_PROMPT_FILE" "$STAGE_LOG" "$STALL_MIN" "$MAX_MIN" "clients/$SLUG" \
    || { echo "dispatch-staged: stage $STAGE dispatch exited non-zero -- stopping the loop, inspect $STAGE_LOG and clients/$SLUG/data/.resume-prompt.md"; exit 1; }

  NEW_DETECT_OUT="$(node scripts/detect-resume-stage.mjs "$SLUG")"
  NEW_STAGE="$(echo "$NEW_DETECT_OUT" | grep '^STAGE=' | cut -d= -f2)"
  if [ "$NEW_STAGE" = "$STAGE" ]; then
    echo "dispatch-staged: stage $STAGE dispatch completed but detected stage did not advance -- likely stuck or genuinely failed (e.g. QA still FAILing at round 3 max). Stopping the loop rather than looping forever; check $STAGE_LOG."
    exit 1
  fi
done

echo "dispatch-staged: hit MAX_STAGES=$MAX_STAGES without reaching DEPLOYED -- stopping as a backstop, not a success. Check clients/$SLUG/data/status.md." >&2
exit 1
