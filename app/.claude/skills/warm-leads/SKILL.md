---
name: warm-leads
description: Read-only status report on all warm leads (status = responded). Classifies each by actual thread state and flags who to consider nudging today.
argument-hint: none
allowed-tools: Bash(python3 *), Bash(node *), Bash(sqlite3 *), Read, mcp__supabase__execute_sql
---

# Warm Leads Status Report

Read `prompts/lessons/outreach.md` before starting.

## HARD RULE: Read-only

This skill **never sends anything**. It produces a status report. Any nudges, replies, or status updates that follow must be composed one-by-one by the user under a separate instruction. Do not call `imessage.py send`, `twilio_sms.py send`, `gmail.py reply`, or any `scripts/db.py` write function from this skill.

## Architecture

See `CLAUDE.md` → "Database operations" for the thread-state cache model. The cache pre-filters and sorts the warm-lead pool; the actual bucketing decision below requires reading the full thread for nuance ("speak to my wife", "callback next week", deadlines).

## Step 0: Refresh the cache (responded only)

```bash
python3 scripts/sync_thread_state.py --statuses responded --quiet
```

Targeting just `responded` keeps this fast (~30s for the typical pool) — no need to resync the full pipeline.

## Step 1: Fetch all warm-lead candidates

```sql
SELECT slug, name, phone, email, outreach_channel, outreach_account,
       last_out_date, last_in_date, last_in_preview,
       outgoing_touch_count, has_inbound_since_last_out, notes
FROM clients
WHERE status = 'responded'
ORDER BY last_in_date DESC NULLS LAST;
```

`converted` clients are paid and out of scope. `rejected` / `unreachable` / `outreach_sent` / `lapsed` belong to `/follow-up` or terminal lanes.

## Step 2: For each warm lead, read the thread and assign one bucket

Do this in parallel where possible. Don't skip any.

### How to read each thread

- **SMS:** `python3 scripts/imessage.py read --phone "{phone}" --limit 40` (or `python3 scripts/twilio_sms.py read --phone "{phone}" --limit 40` if `SMS_PROVIDER=twilio`). If you see `(unable to read)` it's usually a tapback (👍 / ❤️) but can occasionally be a parse failure — cross-check with the user before acting.
- **Email:** `python3 scripts/gmail.py search --query '{client_email}' --max 50`. (Klaudius is single-account by design; the script searches inbox and sent together.)
- **WhatsApp:** `node scripts/whatsapp.mjs read --phone "{phone}" --account "{outreach_account}" --limit 40`. The `--account` value comes from the client's `outreach_account` column (e.g. `primary`, `uk-2`). The daemon mirrors every inbound + outbound to local SQLite, so this returns the same data IMAP/chat.db gives for other channels.
- **Instagram / Facebook:** not readable by the skill. Mark as MANUAL in the report and flag that the user has to check Chrome.

### From each thread extract

- `last_msg_date` — timestamp of the most recent message (either side).
- `last_msg_from` — `ME` or `THEM`.
- `client_deadline` — if the client's last message mentions an explicit return date ("back in 10 days from 2026-04-19", "at the end of the month", "callback next week"), extract it.

### Buckets (assign the FIRST that matches, in order)

| Bucket | Condition | Treatment |
|--------|-----------|-----------|
| A — Recently actioned | `last_msg_from = ME` AND age < 2 days | Leave alone — too soon to nudge |
| B — Client deadline pending | `client_deadline` is in the future | Show the deadline; leave alone until then |
| C — Misclassified / dead | Thread shows no actual inbound (DB says responded but it's one-sided), OR the "reply" is a clear rejection in disguise ("have a site in dev"), OR is unrelated to the pitch (parts list, off-topic) | Suggest re-class to `rejected` or `outreach_sent` |
| E — Needs response from user | `last_msg_from = THEM` (any age) | Client is waiting on you — sort within bucket by age ascending, oldest first |
| F — Nudge candidate | `last_msg_from = ME` AND age ≥ 5 days, none of the above | Ball in their court for 5+ days — genuine nudge candidate. The user decides nudge-vs-breakup from the actual thread content. |

## Step 3: Output the report

Order: E (highest priority — client waiting), then F, then others. Use the cached `last_in_preview` for the truncated last-message column where the latest message is from the client; for outgoing-last threads, summarise the outbound message yourself.

```
=== WARM LEADS REPORT — {today} ===

NEEDS RESPONSE ({count}) — client is waiting on you:
| Client | Channel | Days waiting | Last message (truncated) |
...

NUDGE CANDIDATES ({count}) — ball in their court, 5+ days silent:
| Client | Channel | Days silent | Thread state |
...

WAITING ON CLIENT DEADLINE ({count}):
| Client | Deadline | Notes |
...

RECENTLY ACTIONED ({count}) — leave alone, you acted within 48h:
| Client | Last action | When |
...

MISCLASSIFIED / DEAD ({count}) — consider re-classing:
| Client | DB status | Actual thread state | Suggested new status |
...

MANUAL CHANNEL ({count}) — not readable by skill: {comma-separated slugs}

SUMMARY: {N} warm leads total. {E} need response, {F} nudge candidates.
```

## Step 4: Stop

End the skill after printing the report. Do not propose specific message wording, do not offer to send anything. If the user wants to act on entries, that's a separate workflow (manual per-thread composition).

## Rules

- **No sends, no DB writes** (see the HARD RULE above — this is the approval gate that keeps us from mass-spamming warm leads). Misclassifications go in the report, not into `set_response` / `set_rejected`; the user actions those manually.
- **Thread is source of truth.** The cache's `last_in_preview` is one line; bucketing needs the full thread.
- **Dates are absolute.** Convert all thread timestamps to absolute dates.
- **Don't hallucinate thread content.** If the SMS read returns "No messages found", say so — don't guess.
