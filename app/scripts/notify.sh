#!/bin/bash
# Send a pipeline notification to the operator.
# Usage: ./scripts/notify.sh "Your message here"
#
# The channel is picked by NOTIFY_CHANNEL in .env (see .env.example):
#   telegram (default) — requires TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
#   email              — sends to NOTIFY_TO (default: EMAIL_ADDRESS, i.e.
#                        your own inbox) via scripts/gmail.py
#   sms                — sends to NOTIFY_TO (default: TEST_PHONE, i.e.
#                        your own phone) via your configured SMS_PROVIDER
#
# If the chosen channel isn't configured, this script silently exits 0 so
# callers don't fail — notifications are optional, the pipeline is not.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Load .env if present.
#
# We defensively `set +u` around the source because legacy .env files
# (written by Klaudius CLI < 0.3.1) can contain values with literal `$`
# characters — e.g. `PRICING=$999` — that bash interprets as an
# unset positional parameter, which under nounset throws
# "$9: unbound variable" and brings the whole alert flow down. Quoting
# fixed at write-time in env-writer.ts (0.3.1+), but until every buyer
# is on 0.3.1 we can't assume the file is well-formed.
#
# The values this script consumes (NOTIFY_*, TELEGRAM_*, EMAIL_ADDRESS,
# TEST_PHONE, SMS_PROVIDER) are shell-clean tokens, so any silent
# mis-parse of $-containing values elsewhere in .env doesn't affect
# this script's correctness.
if [ -f "$PROJECT_DIR/.env" ]; then
  set -a
  set +u
  # shellcheck disable=SC1091
  source "$PROJECT_DIR/.env"
  set -u
  set +a
fi

# Normalise so a hand-edited `NOTIFY_CHANNEL=Email` routes the same as
# `email` (notify.ps1's switch is case-insensitive; keep bash matching it).
# NOTIFY_FORCE_CHANNEL wins over NOTIFY_CHANNEL and is set ONLY by this
# script's own fan-out (see the guard further down). It exists because .env is
# sourced above and would otherwise overwrite anything the parent passed in,
# turning the fan-out into infinite recursion.
# ⛔ HARD RECURSION GUARD. On 2026-08-15 this script fork-bombed to 3,530
# self-parented processes from ONE alert; every fork() started failing EAGAIN
# and it broke `npx`, `next build` and eventually `echo` for every other
# process on the machine. Two separate defects produced it, and BOTH are
# closed here:
#
#   1. The child re-sources .env, which restored the comma list the parent was
#      trying to override. Fixed by NOTIFY_FORCE_CHANNEL, a name .env never
#      sets.
#   2. `${NOTIFY_FORCE_CHANNEL:-...}` uses `:-`, so an EMPTY value (a trailing
#      or doubled comma yields one) fell straight back to the comma list and
#      recursed forever. `${VAR+set}` tests PRESENCE, not emptiness — an empty
#      forced channel now stays empty and terminates.
#
# The depth counter below is the backstop that does not depend on getting
# either of those right. It is deliberately dumb and fails CLOSED.
#
# It counts INVOCATIONS, incrementing on entry before any channel logic runs,
# so it bounds recursion arriving through ANY path — not just the `*,*)`
# fan-out. That matters: notify.sh's email branch shells out to gmail.py, and
# any future script that alerts on its own failure could close a cycle that
# never touches the fan-out at all. A guard sited at the fan-out would not see
# that; a guard sited at entry does.
#
# Depths: 1 = the caller's own invocation, 2 = a fan-out child. Anything at 3
# is by definition a grandchild, which this script has no legitimate reason to
# produce, so it refuses. The cap is total processes = 1 + (number of channels),
# regardless of which defect is reintroduced above.
NOTIFY_DEPTH="${NOTIFY_DEPTH:-0}"
# A non-numeric or empty inherited value would make `-gt` a syntax error under
# `set -u`/arithmetic and take the guard offline exactly when it is needed, so
# anything that is not a plain integer restarts the count rather than trusting it.
case "$NOTIFY_DEPTH" in ''|*[!0-9]*) NOTIFY_DEPTH=0 ;; esac
NOTIFY_DEPTH=$((NOTIFY_DEPTH + 1))
export NOTIFY_DEPTH
if [ "$NOTIFY_DEPTH" -gt 2 ]; then
  # Non-zero on purpose. Everywhere else this script exits 0 so a missing
  # channel never fails a pipeline, but this branch means the alerting layer
  # is malfunctioning, and a silent 0 is what let the first fork bomb run to
  # 3,530 processes unnoticed. Safe to be loud: every caller already tolerates
  # a non-zero notify — db.py uses `check=False`, the fan-out uses `|| true`,
  # and the skills invoke it as a bare command whose status nothing reads.
  echo "notify.sh: recursion depth $NOTIFY_DEPTH — refusing to re-invoke (fork-bomb guard)." >&2
  exit 3
fi

if [ -n "${NOTIFY_FORCE_CHANNEL+set}" ]; then
  CHANNEL="$(printf '%s' "$NOTIFY_FORCE_CHANNEL" | tr '[:upper:]' '[:lower:]')"
else
  CHANNEL="$(printf '%s' "${NOTIFY_CHANNEL:-telegram}" | tr '[:upper:]' '[:lower:]')"
fi
# An empty resolved channel delivers nowhere and must never re-expand.
[ -n "$CHANNEL" ] || exit 0

# Probe mode: `notify.sh --configured` exits 0 if the resolved channel has
# the config it needs to actually deliver, 1 otherwise. Lets callers (e.g.
# outreach-notify-simple.sh) skip expensive message-building work when the
# alert would be dropped anyway. Sends nothing.
if [ "${1:-}" = "--configured" ]; then
  case "$CHANNEL" in
    none|off) exit 1 ;;
    email) [ -n "${NOTIFY_TO:-${EMAIL_ADDRESS:-}}" ] && exit 0 || exit 1 ;;
    sms)   [ -n "${NOTIFY_TO:-${TEST_PHONE:-}}" ] && exit 0 || exit 1 ;;
    *)     [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ] && exit 0 || exit 1 ;;
  esac
fi

MESSAGE="${1:-}"
[ -n "$MESSAGE" ] || exit 0

# --no-url-check on every send below: the outreach scripts' deployed-URL
# liveness gate exists so a CLIENT never receives a dead link, but operator
# alerts are frequently *about* a dead URL — without the flag, the gate
# would swallow exactly the "deploy failed, here's the broken URL" alerts
# that matter most.
# NOTIFY_CHANNEL accepts a COMMA-SEPARATED list (e.g. `telegram,slack`) and
# delivers to every member. A single value behaves exactly as before, so
# existing installs are untouched. Telegram reaches the operator's phone;
# Slack reaches the team and leaves a searchable record - a build failure
# wants both, and forcing a choice means one audience never finds out.
# Implemented by re-invoking self once per channel.
#
# ⚠️ THE GUARD BELOW IS LOad-BEARING — DO NOT REMOVE IT.
# This script sources .env near the top. A naive fan-out that re-invokes
# itself with `NOTIFY_CHANNEL=telegram "$0" ...` DOES NOT WORK: the child
# re-reads .env, gets `telegram,slack` back, and fans out again — infinite
# recursion, one alert delivered per iteration. That happened for real on
# 2026-08-15 and buried the operator's phone in Telegram messages until the
# processes were killed.
#
# NOTIFY_FORCE_CHANNEL is the fix precisely because .env never defines it,
# so sourcing .env cannot clobber it. The child sees a single channel, the
# `*,*)` branch does not match, and recursion terminates after one level.
case "$CHANNEL" in
  *,*)
    for c in $(printf '%s' "$CHANNEL" | tr ',' ' '); do
      NOTIFY_FORCE_CHANNEL="$c" "$0" "$MESSAGE" || true
    done
    exit 0
    ;;
esac

case "$CHANNEL" in
  none|off)
    # Explicitly disabled — the wizard writes no NOTIFY_CHANNEL for "None",
    # but `none`/`off` are the obvious hand-edit spellings; honour them even
    # when Telegram creds are still present in .env.
    exit 0
    ;;
  email)
    TO="${NOTIFY_TO:-${EMAIL_ADDRESS:-}}"
    if [ -z "$TO" ]; then
      echo "Email notifications not configured (no NOTIFY_TO or EMAIL_ADDRESS in .env). Skipping notify." >&2
      exit 0
    fi
    python3 "$SCRIPT_DIR/gmail.py" send --to "$TO" --subject "Gray Reserve Builder alert" --body "$MESSAGE" --no-url-check > /dev/null 2>&1 \
      || echo "notify.sh: email alert send failed" >&2
    ;;
  slack)
    # Gray Reserve has a Slack BOT TOKEN (xoxb-) plus channel ids, not an
    # incoming webhook, so chat.postMessage is the real path here. The webhook
    # branch stays as a fallback for installs that only have one.
    #
    # Severity routing: anything that reads like a failure goes to
    # SLACK_CHANNEL_ERRORS; everything else to SLACK_CHANNEL (falling back to
    # the prospecting channel). A build failure buried in a feed of "site is
    # live" notices is a missed failure, which defeats the point of alerting.
    case "$MESSAGE" in
      *FAILED*|*ERRORED*|*failed*|*error*|*wedged*)
        TARGET="${SLACK_CHANNEL_ERRORS:-${SLACK_CHANNEL:-}}" ;;
      *)
        TARGET="${SLACK_CHANNEL:-${SLACK_CHANNEL_PROSPECTING:-}}" ;;
    esac
    if [ -n "${SLACK_BOT_TOKEN:-}" ] && [ -n "$TARGET" ]; then
      PAYLOAD="$(python3 -c 'import json,sys; print(json.dumps({"channel": sys.argv[1], "text": sys.argv[2]}))' "$TARGET" "$MESSAGE")"
      RESP="$(curl -s -X POST https://slack.com/api/chat.postMessage -H "Authorization: Bearer ${SLACK_BOT_TOKEN}" -H 'Content-type: application/json; charset=utf-8' --data "$PAYLOAD")"
      case "$RESP" in
        *'"ok":true'*) : ;;
        *) echo "notify.sh: Slack post failed: $RESP" >&2 ;;
      esac
    elif [ -n "${SLACK_WEBHOOK_URL:-}" ]; then
      PAYLOAD="$(python3 -c 'import json,sys; print(json.dumps({"text": sys.argv[1]}))' "$MESSAGE")"
      curl -s -X POST -H 'Content-type: application/json' --data "$PAYLOAD" "$SLACK_WEBHOOK_URL" > /dev/null || echo "notify.sh: Slack webhook failed" >&2
    else
      echo "Slack not configured (need SLACK_BOT_TOKEN + channel id, or SLACK_WEBHOOK_URL). Skipping." >&2
    fi
    ;;
  sms)
    TO="${NOTIFY_TO:-${TEST_PHONE:-}}"
    if [ -z "$TO" ]; then
      echo "SMS notifications not configured (no NOTIFY_TO or TEST_PHONE in .env). Skipping notify." >&2
      exit 0
    fi
    if [ "${SMS_PROVIDER:-}" = "twilio" ]; then
      python3 "$SCRIPT_DIR/twilio_sms.py" send --to "$TO" --body "$MESSAGE" --no-url-check > /dev/null 2>&1 \
        || echo "notify.sh: SMS alert send failed (twilio)" >&2
    else
      python3 "$SCRIPT_DIR/imessage.py" send --to "$TO" --body "$MESSAGE" --no-url-check > /dev/null 2>&1 \
        || echo "notify.sh: SMS alert send failed (imessage)" >&2
    fi
    ;;
  *)
    # telegram (the default). An unrecognised NOTIFY_CHANNEL value also
    # lands here so a hand-edited typo degrades to the long-standing
    # default rather than silently disabling alerts.
    if [ -z "${TELEGRAM_BOT_TOKEN:-}" ] || [ -z "${TELEGRAM_CHAT_ID:-}" ]; then
      echo "Telegram not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID missing in .env). Skipping notify." >&2
      exit 0
    fi
    # --data-urlencode (NOT -d) so `&`, `=`, `+` in the message can't split
    # the form field and truncate the alert. No parse_mode: alerts routinely
    # carry raw error strings with unbalanced `_`/`*`, which Markdown
    # parse-mode rejects with HTTP 400 — dropping the alert exactly when it
    # matters most. Plain text always delivers.
    curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
      --data-urlencode "text=${MESSAGE}" > /dev/null
    ;;
esac

exit 0
