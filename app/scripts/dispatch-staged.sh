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

# BASE_CONTEXT_FILE must be a context-only brief (client facts, mode, proof requirements) -- NOT a
# numbered "run the full pipeline from scratch" prompt like the single-shot dispatch prompts under
# prompts/dispatch/. Code-review finding, 2026-08-19: concatenating a full pipeline prompt with a
# stage-scope suffix produces a DIRECT instruction conflict -- e.g. the base file says "1. Claim the
# client fresh... 2. /gather" while the suffix for a later stage says "do NOT re-run /gather", and a
# real agent reading both has no principled way to know which wins. Refuse to proceed rather than
# silently dispatching a self-contradictory prompt.
if grep -qE '^\s*[0-9]+\.\s*\*\*.*(Claim the client|/gather|/build|/deploy)' "$BASE_CONTEXT_FILE" 2>/dev/null; then
  echo "dispatch-staged.sh: BASE_CONTEXT_FILE ($BASE_CONTEXT_FILE) looks like a numbered full-pipeline prompt (matches a 'N. **Claim/gather/build/deploy**' step), not a context-only brief." >&2
  echo "This WILL produce a self-contradictory stage prompt. Write a plain context brief (client facts, mode, proof requirements — no step list) and pass that instead." >&2
  exit 1
fi

LOG_DIR="logs"
mkdir -p "$LOG_DIR"

# ── PLAYWRIGHT MUST NOT OUTLIVE THE PIPELINE ─────────────────────────────────────────────────
# dispatch-build.sh sweeps orphaned playwright sessions when it is the LAST dispatch alive — but
# in staged mode THIS script is still running when each child exits, so that guard correctly
# declines every time and nothing ever sweeps at the end. Same sweep, at the point where the
# pipeline genuinely stops. Operator rule: "playwright has to stop when builds stop."
sweep_playwright() {
  [ -n "$(pgrep -f 'dispatch-(staged|build)\.sh' | grep -v "^$$\$")" ] && return 0
  local n
  n=$(pgrep -f 'cliDaemon.js' 2>/dev/null | wc -l | tr -d ' ')
  [ "${n:-0}" -eq 0 ] && return 0
  for pw in $(pgrep -f 'cliDaemon.js' 2>/dev/null); do
    pkill -P "$pw" 2>/dev/null; kill -9 "$pw" 2>/dev/null
  done
  echo "pipeline finished — swept $n orphaned playwright session(s)"
  return 0
}
trap 'sweep_playwright' EXIT

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
    PRE_GATHER)
      MODEL=sonnet; EFFORT=medium
      STAGE_PROMPT_SUFFIX="Run ONLY the /gather step for this client (and /find first if the client is not yet claimed -- check status before assuming). Stop once gathered-content.md is written and looks complete against the coverage checklist. Do NOT run /ui-ux-pro-max, /build, QA, or /deploy in this dispatch -- a separate dispatch handles those at a different model tier." ;;
    POST_GATHER)
      # BUG FOUND 2026-08-20, live, on the FIRST-EVER real dispatch-staged.sh run: this was grouped
      # with PRE_GATHER above and given the gather-only prompt. detect-resume-stage.mjs's own
      # definition (its PRE_GATHER/POST_GATHER branch, checked directly) says POST_GATHER means
      # "gathered-content.md exists, design-system.md does not" -- i.e. gather is DONE, design/build
      # is next. Routing it to "run ONLY /gather" told a real child to re-run gather on data that was
      # already valid and hand-patched (inline unrated-review markers) — caught and killed within
      # seconds, before any damage, but only because it was watched live. This IS the reason to
      # actually run new infrastructure once before trusting it: a static read of both files
      # separately missed the mismatch; only comparing detect-resume-stage.mjs's OWN semantics
      # against this case statement's routing surfaced it.
      MODEL=opus; EFFORT=high
      STAGE_PROMPT_SUFFIX="gather is already complete (see clients/$SLUG/data/gathered-content.md -- do NOT re-run /gather). Run /ui-ux-pro-max then /build for this client. Stop once build's Verify step has genuinely passed (VERIFY_GATES_OK_AT written to status.md) or self-fixed to a clean pass. Do NOT run the QA loop or /deploy in this dispatch." ;;
    POST_DESIGN_PRE_VERIFY)
      # BUG FOUND 2026-08-20, same live-testing pass that found the POST_GATHER bug above. This
      # stage is only reached once has(designSystem) is ALREADY true (detect-resume-stage.mjs's own
      # branch order: POST_DESIGN_PRE_VERIFY is the `else if` after the has(designSystem) check), so
      # its resumeInstruction says "/gather and /ui-ux-pro-max are done — DO NOT re-run either...
      # re-run /build ${slug} from the top — it is idempotent per-page". This block previously told
      # the child to "Run /ui-ux-pro-max then /build" — re-running a design consult whose own
      # artefact (design-system.md) already exists is exactly the "the output IS the artifact, never
      # overwrite it" violation named elsewhere in build/SKILL.md, just reintroduced at the dispatch
      # layer instead of inside the build itself.
      MODEL=opus; EFFORT=high
      STAGE_PROMPT_SUFFIX="gather AND the design consult are already complete (see clients/$SLUG/data/gathered-content.md and clients/$SLUG/data/design-system.md -- do NOT re-run /gather or /ui-ux-pro-max, and do NOT edit design-system.md). Run /build ${SLUG} from the top -- it is idempotent per-page and will overwrite whatever partial pages exist. Stop once build's Verify step has genuinely passed (VERIFY_GATES_OK_AT written to status.md) or self-fixed to a clean pass. Do NOT run the QA loop or /deploy in this dispatch." ;;
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
