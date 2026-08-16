---
name: follow-up
description: Check for client replies and send due follow-ups across email, SMS, and WhatsApp
argument-hint: [optional: sms|email|whatsapp|all]
allowed-tools: Bash(python3 *), Bash(node *), Bash(*/notify.sh *), Read, Edit, Write, mcp__supabase__execute_sql
---

# Follow-up Management

Read `prompts/lessons/outreach.md` before starting.

## HARD RULE: Never send without explicit user confirmation

The skill is split into a propose phase (Steps 0–2) and a send phase (Step 3). The propose phase is read-only and always runs. The send phase is gated by the user's explicit approval of the proposed plan. Do NOT send any follow-up — not even one — until the user has seen the proposed list and written an explicit go-ahead ("send them", "yes", "go ahead", "send first 10", etc.). Silence is not approval. A prior approval from an earlier session is not approval for this session. If the user says "run /follow-up", that is NOT a send authorisation — that is a request for the proposal.

If the proposal contains zero candidates, say so and stop. If it contains 1+, present the table (see "Present the plan for approval") and wait. Do not begin Step 3 under any circumstances until the user replies with an explicit send instruction.

## Architecture

See `CLAUDE.md` → "Database operations" for the thread-state cache model. Short version: the real threads are the source of truth — chat.db or Twilio's message log for SMS (per `SMS_PROVIDER`), IMAP for email; the cache columns on `clients` are a snapshot refreshed by `scripts/sync_thread_state.py` at the start of every run of this skill.

## Step 0: Refresh the cache

```bash
python3 scripts/sync_thread_state.py --quiet
```

Walks every client whose conversation might still move (status `outreach_sent` or `responded`) and rewrites the cache. ~6–7 minutes for ~1000 clients. Skip only if you've been told the cache was just synced.

## Step 1: Auto-triage every cold-cadence thread that has any inbound

```bash
python3 scripts/check-replies.py --channel ${ARGUMENTS:-all}
```

Lists two kinds of row in one pass:

- **Cold** (`status='outreach_sent'`, at least one inbound on record, cache not yet triaged for the latest inbound). Catches: the client just replied; you replied manually and buried the inbound; a new inbound arrived after a previous classification went stale.
- **Warm** (`status='responded'`, labelled `[warm reply — client spoke last]`, listed first): an engaged client's newest message is unanswered. **Never send anything in the warm lane** — surface these with previews and offer to draft replies. One classification is allowed: a warm inbound that's pure noise (bare tapback like 👍, auto-ack, OOO) gets `classify_inbound('SLUG','noise','LAST_IN_DATE')` so it stops surfacing every run; it reappears on the client's next real message. Anything with content gets surfaced for the user, never classified. (Mis-dismissed something? `python3 scripts/check-replies.py --include-noise` lists dismissed rows as `[warm — dismissed as noise]` — reply, or re-classify it `unclear` to resurface it.)

For each COLD row, decide one of four outcomes and apply directly. **You do the classification — read the preview, dig the thread if the preview is ambiguous, act.** Status changes from `genuine`/`rejection` automatically remove the row from the outreach_sent pool, so they drop out of the rest of the skill's queries.

| Bucket     | What it looks like | Action |
|------------|--------------------|--------|
| `noise`    | tapbacks (`👍 to "..."`); OOO ("out of the office until..."); generic auto-acks ("we received your email", "this is an automated reply"). Server/template, not human. | `classify_inbound('SLUG','noise','LAST_IN_DATE')` |
| `rejection`| Any clear no — "not interested", "no thanks", "stop messaging", "have a site in development". | `set_rejected('SLUG','one-line reason')` |
| `genuine`  | Real engagement — questions about price/domain/timing, "speak to my wife", "send me details", or any thread where you've been having a real back-and-forth manually. | `set_response('SLUG','one-line reason')` |
| `unclear`  | Short, ambiguous. Default here when in doubt — better a false review than a false auto-action. | `classify_inbound('SLUG','unclear','LAST_IN_DATE')` |

Pass `last_in_date` verbatim from the row (UTC ISO timestamp) — that locks the classification to this specific inbound, so a future inbound forces re-triage.

When the preview is enough vs. when to dig: tapback / OOO / "no thanks" / "what's the price?" — preview alone. Dig the thread when (a) the preview is short and ambiguous ("ok", "thanks"), (b) you suspect a real exchange happened manually, or (c) on iMessage installs, you need to confirm the SMS thread isn't keyed under email (Twilio threads are keyed by phone only, so (c) never applies there):

```bash
python3 scripts/imessage.py read --phone "PHONE" --limit 30                  # SMS_PROVIDER=imessage
python3 scripts/twilio_sms.py read --phone "PHONE" --limit 30 --strict      # SMS_PROVIDER=twilio
python3 scripts/gmail.py search --query 'FROM "EMAIL"'```

After all rows are acted on, print a one-block summary:

```
Step 1 auto-triage:
  ⚡ Warm replies awaiting YOUR answer: N (slug, slug, ...) — see previews below
  Marked rejection: N (slug, slug, ...)
  Promoted to responded: N (slug, slug, ...)
  Marked noise: N (slug, slug, ...)
  Unclear (need your eyes): N — see below
```

Then surface the warm-reply rows (with previews) and the `unclear` rows for the user to look at. Everything else has been handled. Warm replies outrank everything else in this skill: a due cold follow-up can slip a day; an engaged client waiting on an answer cannot.

## Step 1b: Bounces

The sync doesn't catch bounces — they arrive as `mailer-daemon` messages, not as inbound from the client. **Always run this step** unless zero email outreach has been sent since the last /follow-up run — a missed bounce means the next cycle sends another dead message into the void.

Search the configured outreach mailbox over a fixed 14-day rolling window (wide enough to cover any gap between runs plus straggler bounces; re-seeing an already-handled bounce is harmless, missing a fresh one isn't). Compute the date in the shell so the window slides automatically:

```bash
SINCE=$(date -v-14d +%-d-%b-%Y)   # e.g. "23-Apr-2026"
python3 scripts/gmail.py search --query "FROM \"mailer-daemon\" SINCE $SINCE" --max 30
```

For each bounce found, look up the client by email — skip if already on `outreach_channel='sms'` (a previous run switched them) or already marked `unreachable`.

Note: IMAP search doesn't accept the compound `OR FROM "..." SUBJECT "..."` form — use the plain `FROM "mailer-daemon"` query above. The `SINCE` value must be in `D-Mon-YYYY` (or `DD-Mon-YYYY`) format. The macOS `date -v-14d` syntax above produces the right shape; on Linux use `date -d '14 days ago' +%-d-%b-%Y` instead.

For each bounce, identify the failed recipient from the bounce body, match to a client, then propose to the user:
- Has a mobile phone? Switch `outreach_channel` to `sms`, reset `outreach_first_sent` to today, send fresh outreach via SMS, note the bounce in `notes`.
- No alternative contact? `set_unreachable` with a note.

Always present bounced clients to the user for approval before changing channel or status.

## Step 1c: Lapsed sweep

After the breakup (5th outgoing touch — initial + 4 follow-ups) lands and a grace period passes with no real reply, close out as `lapsed`. Without this, breakups linger in `outreach_sent` and pollute every status count.

`lapsed` ≠ `unreachable`: lapsed = full sequence delivered, no engagement. Unreachable = no contact channel ever worked.

**Propose-then-approve.** Don't flip any client to `lapsed` without showing the list first.

```sql
SELECT slug, name, outreach_channel, last_out_date, outgoing_touch_count,
       (CURRENT_DATE - last_out_date::date) AS days_since
FROM clients
WHERE status = 'outreach_sent'
  AND (
        has_inbound_since_last_out = false
     OR (last_in_classification = 'noise'
         AND last_in_classified_for_date = last_in_date)
      )
  AND outgoing_touch_count >= 5
  AND last_out_date <= NOW() - INTERVAL '7 days'
ORDER BY last_out_date ASC;
```

The fresh-noise passthrough (`OR (last_in_classification = 'noise' …)`) means a client who OOO'd during the cadence but never engaged for real is still lapsed correctly. Pure manual-DM channels (instagram_dm, facebook_messenger) have `outgoing_touch_count = 0` (sync skips them — no auto-readable backend) and never appear here. WhatsApp clients DO appear here: the daemon mirrors every message to local SQLite, so the cadence advances normally.

Present the list:

```
End-of-sequence clients to mark as lapsed (NOT closed yet — awaiting your approval):
| # | Business | Channel | Last touch | Days since |
|---|----------|---------|------------|------------|
...
Total: X clients

Reply "lapse all", "lapse first N", specific slugs, or "skip" to cancel.
```

For each approved slug:
```bash
python3 -c "from scripts.db import set_lapsed; set_lapsed('SLUG', 'Completed 5-touch sequence, no response within grace period')"
```

Commit and push after the batch.

## Step 2: Propose follow-ups (DO NOT SEND YET)

A client is **due** when:
- `status = 'outreach_sent'`
- No real reply (same predicate as Step 1c — `has_inbound_since_last_out = false` OR fresh-noise)
- `outgoing_touch_count BETWEEN 1 AND 4`
- The cadence gap has elapsed (per the table below)

Cadence rule keyed on the *current* `outgoing_touch_count`. Touch numbers match CLAUDE.md's "Outreach Sequence" table:

| count | Next touch to send       | Seq. day | Min gap | Angle |
|-------|--------------------------|----------|---------|-------|
| 1     | Touch 2 (1st follow-up)  | 3        | 3 days  | Soft nudge |
| 2     | Touch 3 (2nd follow-up)  | 7        | 4 days  | Decision moment |
| 3     | Touch 4 (3rd follow-up)  | 14       | 7 days  | Verification |
| 4     | Touch 5 (breakup)        | 21       | 7 days  | "Site is still live if you change your mind" |
| ≥5    | (lapsed sweep)           | —        | —       | — |

Stage A query:

```sql
SELECT slug, name, phone, email, outreach_channel,
       outgoing_touch_count, last_out_date, deployed_url,
       outreach_account, outreach_message_id, outreach_subject,
       website, extra,
       (NOW() - last_out_date) AS age
FROM clients
WHERE status = 'outreach_sent'
  AND (
        has_inbound_since_last_out = false
     OR (last_in_classification = 'noise'
         AND last_in_classified_for_date = last_in_date)
      )
  AND outgoing_touch_count BETWEEN 1 AND 4
  AND outreach_channel IN ('sms','email','whatsapp')
  AND last_out_date <= NOW() -
      (CASE WHEN outgoing_touch_count = 1 THEN INTERVAL '3 days'
            WHEN outgoing_touch_count = 2 THEN INTERVAL '4 days'
            ELSE INTERVAL '7 days' END)
ORDER BY last_out_date ASC;
```

#### Optional: iMessage-only follow-ups (when SMS carrier rate-limits)

iMessage installs only. Add `AND (outreach_channel != 'sms' OR imessage_capable = true)` to the WHERE. Restricts SMS-lane to clients whose `imessage_capable` was probed `true`; NULL/false drop out. Email lane unchanged. Never apply this on a Twilio install — `imessage_capable` is never probed there (stays NULL), so the filter would empty the entire SMS lane.

### Stage B: per-thread guard before each send

The cache is fresh from Step 0, so Stage B is just a final guard against drift in the last few minutes (a manual reply that arrived after sync). Per send:
- SMS: `python3 scripts/imessage.py read --phone "PHONE" --limit 30` (or `python3 scripts/twilio_sms.py read --phone "PHONE" --limit 30 --strict` if `SMS_PROVIDER=twilio`) — verify no inbound since `last_out_date`. If the read errors or prints a WARN, treat the guard as failed and skip this send — a partial thread can hide a reply.
- Email: `python3 scripts/gmail.py search --query 'FROM "EMAIL"'` — same.
- WhatsApp: `node scripts/whatsapp.mjs read --phone "PHONE" --account "ACCOUNT_FROM_OUTREACH_ACCOUNT" --limit 30` — same. The `account` is the value stored in the client's `outreach_account` column (e.g. `primary`, `uk-2`), so the read hits the same daemon that originally sent.

If a fresh inbound shows up, treat it as Step 1 (classify) and do NOT send the follow-up.

Two more checks per candidate before send: confirm `deployed_url` is a real `https://` URL (never send a follow-up containing `None`); same-day dedup against the SMS thread (chat.db, or `twilio_sms.py read` if `SMS_PROVIDER=twilio`) / your email Sent folder (skip if you already sent today).

### Present the plan for approval (MANDATORY — STOP here until user replies)

```
Follow-ups proposed (NOT sent yet — awaiting your approval):
| # | Business | Channel | Next touch | Days since last | Angle |
|---|----------|---------|------------|-----------------|-------|
| 1 | Example  | sms     | Touch 2    | 5 days          | Soft nudge |
...
Total: X follow-ups (Y email, Z sms)

Reply "send all", "send first N", specific slugs, or "skip" to cancel.
```

**Stop talking and wait.** Do NOT call any send tool, do NOT prep messages. Triggers to move to Step 3: "send all" / "send first N" / "send these: slug1, slug2".

## Step 3: Send approved follow-ups

### HARD RULE: Email batches — canary first, verify threading.

Batches with ≥5 emails MUST split. Send the first 3–5, individually composed. Verify each landed in your email Sent folder with correct `In-Reply-To` and `References` headers (threading correctly with the prior message). If any canary lands as a new thread, STOP — investigate the threading break (missing Message-ID, reply helper changed). Only after canary verified, send the rest.

SMS batches don't need a canary (no threading concept) but every send still follows the one-at-a-time rule.

### HARD RULE: One at a time, by you, never via a script.

Every follow-up is composed and sent individually, with reasoning applied to that specific thread. **Forbidden:** subprocess loops over a list of follow-ups; mail-merge templates that interpolate name/url/industry without reading the thread; reusing the same phrasing verbatim across clients in one session. A batch script can't notice a sarcastic last reply, a price you dropped mid-thread, "speak to my partner first", a 404 URL, or an industry-specific objection. Mail-merge kills the pitch.

**Per-client pattern:**
1. Read the full thread for THIS client.
2. Reason about what they need to hear right now — prior replies, last message, gap, industry/town, price hints.
3. Compose the message inline in a bash send command. Tailor phrasing to this thread.
4. Send.
5. Verify the send landed (read the thread back).
6. Move to the next client.

If 50 are due, that's 50 rounds. Slow is the point.

### Rules

- **Honour the originally quoted price.** Quote the price from the original thread, not the current default. Source order: (1) original message in thread, (2) `clients.price` column. Never bump a client to a new price mid-conversation.
- **Same channel only** — SMS-on-SMS, email-on-email, WhatsApp-on-WhatsApp. **No cascade for follow-ups** — unlike the initial-outreach skill, follow-ups can't cross channels because WhatsApp/SMS/email threads are channel-specific. If a follow-up send fails, log it and move on; the cache will catch up on the next sync.
- **WhatsApp follow-ups MUST use the same account that sent the original** — pull `outreach_account` from the client row and pass via `--account`. You can't continue a WhatsApp thread from a different number.
- **Instagram / Facebook** clients are excluded — manual lane (the operator DMs from their own account; there's no auto-readable thread backend).
- **Never follow up if the client has replied** — Stage B is the last guard.
- **Never send test/debug messages to real contacts.**
- **Use the same full message style** — don't shorten for SMS / WhatsApp.

### Sending

**SMS:** `python3 scripts/imessage.py send --to "PHONE" --body "MESSAGE"` (or `python3 scripts/twilio_sms.py send …` if SMS_PROVIDER=twilio).

**WhatsApp:** `node scripts/whatsapp.mjs send --to "PHONE" --body "MESSAGE" --account "ACCOUNT_FROM_OUTREACH_ACCOUNT"`. The `--account` is mandatory for follow-ups (`outreach_account` value from the client row) so the message goes from the same WhatsApp number that started the thread. If the response is `{"ok": false, "error": "<not not_on_whatsapp>"}` (i.e. account-level fail — likely the number got banned or the daemon died), alert via `bash scripts/notify.sh "WhatsApp follow-up failed for SLUG: <reason>"` and skip this client. Do NOT try to switch channels mid-thread.

**Email:** `python3 scripts/gmail.py reply` (keeps follow-ups in the same thread).
1. Pull `outreach_message_id` and `outreach_subject` from Supabase. If missing, search the Sent folder for the original send and grab from there: `python3 scripts/gmail.py search --query 'TO "EMAIL"'`.
2. Get the full email thread by searching the Sent folder for all emails TO this client.
3. `python3 scripts/gmail.py reply --to "EMAIL" --subject "Re: {subject}" --body "MESSAGE" --message-id "{message-id}"`.
4. **Always include the FULL email thread as nested quoted replies** at the bottom. Improves deliverability, gives context, looks like a real chain. Each level gets an additional `>` prefix.

### Language

**Every follow-up goes out in `${OPERATOR_LANGUAGE}`** (from `.env`; falls back to English if unset). The angles and example phrasings below are written in English as the canonical pattern. If `${OPERATOR_LANGUAGE}` is not English, translate each angle into natural idiomatic `${OPERATOR_LANGUAGE}` — match the register and conventions a native speaker would actually use for business follow-up. Same rules as the initial outreach (see `outreach/SKILL.md` → "Language"). Read the full thread before composing — the recipient is reading in `${OPERATOR_LANGUAGE}` and an English follow-up after an `${OPERATOR_LANGUAGE}` first touch reads as a translation error.

### Message angles (adapt per business — never copy-paste)

**Rescue leads** (`extra.mode` = `rescue`, from the Stage A row): these businesses HAVE a website — a broken or dated one — so the "no website to verify" framing in the get-found angle (touch 3) and the "with no website" line in the verification angle (touch 4) are false for them. Rephrase to fit their recorded `extra.site_signals` ("a site that doesn't work on phones", "a site that's showing an error"). Same cadence, same channels.

**Booking leads** (`extra.mode` = `booking`): the verify/get-found angles hold (a Fresha/Booksy page is not THEIR website), but sharpen them to the vertical when natural — clients can book straight from the site at 11pm; people who find them on Google see a real site instead of a shared platform page. Never introduce fee/cost claims in a follow-up that message one didn't make (the fee line is registry-gated at outreach; follow-ups don't re-litigate it). Same cadence, same channels.

**Touch 2 / 1st follow-up (count was 1):** Soft nudge — "just making sure this reached you". Re-surface the link, frame it as not wanting it to get lost, no pressure. e.g. "Hi {owner}, just making sure this reached you - I built {Business Name} a website and wasn't sure it got through: {url}. No pressure at all, just didn't want it to get lost. Have a look when you get a sec? ${SIGNATURE}"

WhatsApp soft-nudge follow-ups should be especially short — WhatsApp messages are read on the lock screen, so leading with "Hey {owner}," and one sentence + URL works better than a full paragraph. Keep the substance, drop the formality.

**Touch 3 / 2nd follow-up (count was 2):** Get-found angle, tied to lost custom. When someone searches "{industry} in {location}" the ones with a website get the click and the others get scrolled past. Concrete, grounded in their trade and town. **Do NOT** claim they "don't show up on Google" or "have nowhere to see their reviews" — most have a Google Business Profile already and will call you out. Angle: customers find them on Maps, then drop off at the next step because there's no website to verify. e.g. "Hi {owner}, the {Business Name} site's still live if you want it. The main thing it does for you: when someone searches "{industry} in {location}", you actually show up - right now that customer just finds whoever's got a website instead. Easy to hand over whenever: {url}. ${SIGNATURE}"

**Touch 4 / 3rd follow-up (count was 3):** Verification angle. Even customers who already find them on Maps (or get their name from a friend) usually look them up before calling — the modern "do they look legit" check — and with no website a good business can look less established than it is. e.g. "Hi {owner}, one more thought and then I'll leave you be. Even people who get your name from a friend tend to look you up online before they call, just to check you're the real deal - and with no website you can look less established than you actually are. Yours is built and ready if you want it: {url}. ${SIGNATURE}"

**Touch 5 / breakup (count was 4):** Respectful close, door left open, restate the offer once (quote the price already in the thread, not a new one). e.g. "Hi {owner}, I'll leave it here so I'm not pestering you. The {Business Name} website's still live at {url} if you ever change your mind - same one-off price, no monthly fees, and I can hand it straight over. All the best either way. ${SIGNATURE}"

**Email** follow-ups MUST include the full email thread quoted below. **Re-read every message before sending** — fix awkward phrasing, grammar, anything that doesn't sound human ("searching for barber" → "searching for a barber"). Same-day dedup before each send (search your email Sent folder / SMS thread for an outgoing today; skip if found).

### After each follow-up

Verify the send landed:
- **SMS** — chat.db has an outgoing content message with today's timestamp (Twilio: `python3 scripts/twilio_sms.py read --phone PHONE --limit 5` shows the message with direction `ME`).
- **Email** — Sent Items has a new message with today's Date header.
- **WhatsApp** — `node scripts/whatsapp.mjs read --phone PHONE --account ACCOUNT --limit 5` shows the message you just sent with `from_me: true`. (The daemon writes outgoing messages to SQLite via the same messages.upsert event listener that captures inbound, so verification is symmetric with the read path.)

**No DB write needed** — the next sync picks up the new outgoing and updates `last_out_date` / `outgoing_touch_count` automatically. If a send fails, do NOT log anything — the cache will reflect that on next sync.

## Step 4: Summary

Print:
- New replies surfaced and statuses updated (Step 1)
- Bounced emails handled (Step 1b)
- End-of-sequence clients lapsed (Step 1c)
- Follow-ups sent (by touch number / channel)
- Errors or skipped clients
