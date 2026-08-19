---
name: outreach
description: Send initial outreach via the operator's priority-ordered channels (email, WhatsApp, SMS), cascading on per-recipient failures
argument-hint: [business-name]
allowed-tools: Bash(python3 *), Bash(node *), Bash(*/outreach-notify-simple.sh *), Bash(*/notify.sh *), Read, Write, Skill
---

# Send Outreach for $ARGUMENTS

**Do not pause to confirm the send with the user. The skill's checks are the gate. Only stop if a specific check fails** (URL doesn't verify, no contact method, claim_outreach returns False, send script errors, etc.). Adding a generic "are you sure?" preview before sending is exactly the friction this skill exists to remove.

Read `clients/$ARGUMENTS/data/gathered-content.md` and check Supabase for contact info and deployed URL: `python3 scripts/db.py client $ARGUMENTS`. Read `prompts/lessons/outreach.md` before starting.

## Draft-only mode (manual approval, no send)

When `OUTREACH_ENABLED=false` — or the operator explicitly asks to "draft but don't send" — do NOT run the send path below. Compose the message using the same wording rules in this skill (length cap, tone, no em-dashes, `${SIGNATURE}`, `${PRICING}` / `${PRICING_TERMS}`), then either:

- save it to `clients/$ARGUMENTS/data/outreach-draft.md` (put the recipient and the deployed URL at the top), or
- drop it straight into the operator's email Drafts with `python3 scripts/gmail.py draft --to "EMAIL" --subject "SUBJECT" --body "MESSAGE"` — nothing is sent; the operator reviews it in their mail client and sends by hand.

Everything below this section is the SEND path — only use it when outreach is enabled and approved.

## Channel Selection (priority + cascade)

Klaudius walks `OUTREACH_PRIORITY` from `.env` (e.g. `email,whatsapp,sms`) in order, picking the first channel that's both **enabled by the operator** (i.e. listed in `OUTREACH_PRIORITY`) AND **viable for this specific client** (the client has the relevant contact field). If a channel's send fails for a per-recipient reason, cascade to the next priority channel for that same client.

Per-channel viability:

| Channel | Viable when client has... | Adapter |
|---|---|---|
| `email` | `email` | `python3 scripts/gmail.py send` |
| `whatsapp` | `phone` (mobile) | `node scripts/whatsapp.mjs send` |
| `sms` | `phone` (mobile) | `python3 scripts/imessage.py send` OR `python3 scripts/twilio_sms.py send` (whichever is configured in `.env` as `SMS_PROVIDER`) |

For each client, walk `OUTREACH_PRIORITY` in order: skip any channel the client isn't viable for (missing the required contact field), then attempt the send via the viable channel's adapter and interpret its JSON result per the **Atomic outreach flow** below (success → mark `outreach_sent`, stop; per-recipient failure like `not_on_whatsapp` → silent cascade, no alert; account-level failure → alert via `scripts/notify.sh` then cascade). If every channel is non-viable or fails, fall back to manual DM when the client has `facebook`/`instagram`, otherwise leave at `deployed` (never mark `unreachable` unless every channel was definitively tried).

The priority list is set during `npx klaudius init` (the wizard prompts for it after the operator ticks the channels they want to use). To change it later, edit `OUTREACH_PRIORITY=` in `.env` directly or re-run `npx klaudius configure`. Channels you didn't tick won't appear in the priority list.

## Channel: Manual DM (Facebook/Instagram)

Do NOT send the DM yourself. Instead:
1. Update the client's `facebook` and/or `instagram` fields in Supabase if not already set
2. Update status to `deployed` (NOT `outreach_sent` — that only happens when the DM is actually sent)
3. Add a note in Supabase: `"Manual DM required - Facebook: URL / Instagram: @handle"`
4. Send a notification so you know to send the DM manually (optional, via `scripts/outreach-notify-simple.sh`)

```bash
python3 -c "from scripts.db import update_client; update_client('SLUG', {'notes': 'Manual DM required - Facebook: URL_HERE'})"
```

When the operator confirms they've sent the DM themselves, close the loop — otherwise every later `/outreach` run re-walks this client's cascade and the "Manual DM required" note goes stale:

```bash
python3 -c "from scripts.db import set_outreach_sent; set_outreach_sent('SLUG', 'instagram_dm')"  # or 'facebook_messenger'
```

That stamps `outreach_first_sent`, records the channel, and moves the client to `outreach_sent`. Replies and follow-ups on DM threads stay manual — there's no auto-readable backend, so the follow-up skill deliberately excludes these clients.

## Channel: Email
Send via: `python3 scripts/gmail.py send --to "EMAIL" --subject "SUBJECT" --body "BODY"`

## Channel: SMS
Send via your configured SMS adapter:
- macOS iMessage: `python3 scripts/imessage.py send --to "PHONE" --body "MESSAGE"`
- Twilio (cross-platform): `python3 scripts/twilio_sms.py send --to "PHONE" --body "MESSAGE"`

Which one to use depends on what you chose during `npx klaudius init`. The choice is recorded in `.env` as `SMS_PROVIDER`.

## Channel: WhatsApp
Send via: `node scripts/whatsapp.mjs send --to "PHONE" --body "MESSAGE"`

WhatsApp uses a long-lived background daemon (one per linked WhatsApp account) that holds the Baileys WebSocket connection. The shim auto-spawns the daemon on first send and IPC's into it for every subsequent operation. Auth state for each account lives in `~/.klaudius/whatsapp/<account>/`.

**Account selection (round-robin):** if the operator has linked multiple WhatsApp numbers, the shim auto-picks one via round-robin across the `WHATSAPP_ACCOUNTS` env list. The picked account is returned in the JSON response (`{"account": "primary", ...}`). You MUST record the account in `outreach_account` so follow-ups go from the same number (you can't continue a WhatsApp thread from a different one).

**Response shape:**
```
{"ok": true,  "to": "+447xxx", "jid": "...", "account": "primary", "message_id": "..."}    -> success, cascade stops
{"ok": false, "error": "not_on_whatsapp", "to": "...", "jid": "...", "account": "primary"} -> per-recipient, silent cascade
{"ok": false, "error": "<other>", ...}                                                      -> ambiguous, alert + cascade
```

Exit codes: `0` success, `2` recipient-level fail (parse JSON), other `non-zero` for ambiguous/account-level.

**Pre-flight:** the daemon does an `onWhatsApp` registry check before attempting the send, so a `not_on_whatsapp` failure costs ~100ms and zero messages-sent. Cascade to the next channel cleanly.

**Inbound:** the daemon writes every inbound to a local SQLite at `~/.klaudius/whatsapp/<account>/messages.db`. `/follow-up` and `/warm-leads` use this via `sync_thread_state.py` — no manual checking needed.

**Pacing:** the daemon enforces a randomised 30-45s gap between sends globally per account; respect that.

**Re-pairing:** if a number gets banned or otherwise needs re-linking, run `npx klaudius pair-whatsapp --label <account>`. The daemon stops, pair runs interactively, daemon respawns on next send.

## Message template (adapt for each business - never copy-paste identically)

Use the same message regardless of channel. For email, also set the subject line.

### Language

**Every message goes out in `${OPERATOR_LANGUAGE}`** (from `.env`; falls back to English if unset). The template body and subject lines below are written in English as the canonical pattern. If `${OPERATOR_LANGUAGE}` is not English:

- Translate every part of the template — subject, salutation, body, photo line, personalisation hook, sign-off — into natural, idiomatic `${OPERATOR_LANGUAGE}`. Not literal English-to-X translation; use phrasing a native speaker would actually write in business correspondence.
- Match the appropriate B2B register for the language and country. For example: formal "voi" plural addressing the business in Italian; "usted" formal in Spanish (LatAm) or "tú" if you've already established familiarity; "vous" in French; "Sie" in German. Pick what a native operator would default to for cold B2B outreach to small business owners.
- Use natural country-specific conventions for greetings ("Buongiorno", "Hola", "Bonjour", "Guten Tag", "Olá") and closing lines (the closing sentence above the signature, e.g. "have a look and tell me if I've got it right?" → "date un'occhiata e ditemi se rispecchia la vostra attività?" in Italian).
- Never insert English boilerplate phrases into a non-English message. Words from the recipient's own business (proper nouns, brand names) stay in their original form.
- The personalisation hook and photo line described below need translating along with the rest.

**Env var values inside the template:**
- `${PRICING}` (e.g. `€899`, `$999`) — verbatim. Currency strings are language-neutral.
- `${PRICING_TERMS}` (e.g. `one-off, no monthly fees`) — descriptive marketing copy. If it's in a different language than `${OPERATOR_LANGUAGE}`, translate it to the natural equivalent at compose time (e.g. `one-off, no monthly fees` → `una tantum, senza canone mensile` in Italian, `pago único, sin cuotas` in Spanish). Don't leave English copy embedded in a non-English message — it reads as an unedited template.
- `${SIGNATURE}` — handle in two modes:
  - **If set in `.env`** (operator pinned a specific sign-off): use it verbatim. Don't auto-translate, don't reformat. Operators set this when they want consistent branded copy; respect that even if it appears to be in a different language than the message body.
  - **If empty/unset** (the default for new installs): compose a natural professional sign-off line using `${OPERATOR_NAME}` from `.env` and the conventions appropriate for `${OPERATOR_LANGUAGE}`. Conventions for common languages:
    - English: `Thanks, {first name}` or `Best, {first name}`
    - Italian: `Cordiali saluti, {first name}` or `Saluti, {first name}`
    - Spanish: `Un saludo, {first name}` or `Saludos, {first name}`
    - French: `Cordialement, {first name}` or `Bien à vous, {first name}`
    - German: `Beste Grüße, {first name}` or `Viele Grüße, {first name}`
    - Portuguese: `Cumprimentos, {first name}` or `Atenciosamente, {first name}`
    - Dutch: `Met vriendelijke groet, {first name}` or `Hartelijke groet, {first name}`
    - For any other language, pick a natural professional sign-off + the operator's first name in that language.
  - Use the operator's FIRST name only by default (extract from `${OPERATOR_NAME}` by splitting on whitespace and taking the first token). If `${OPERATOR_NAME}` is a business name rather than a person's name, use the whole thing.

If you're not confident the translation reads naturally for a native speaker, prefer a simpler sentence over a literal one. A short, plain message in good `${OPERATOR_LANGUAGE}` beats a clever one with translation tells.


**Subject** (email only): Pick one at random from these five templates — rotate to avoid repetition:
1. "I built a website for {Business Name}"
2. "Website for {Business Name}, take a look?"
3. "I made {Business Name} a website"
4. "Built a website for {Business Name}, thoughts?"
5. "I put a website together for {Business Name}"

**Body** (55-80 words — shorter is better; brevity is the whole point):
```
Hi {owner name if known}, I built {Business Name} a website and wanted to show you - here it is:

{deployed_url}

{photo line - see below} {personalisation hook - see below} If you want to keep it it's ${PRICING} ${PRICING_TERMS}. No pressure either way - have a look and tell me if I've got it right?

${SIGNATURE}
```

- **No owner name?** Drop the placeholder cleanly: `"Hi, I built {Business Name} a website and wanted to show you ..."`.
- **Lead with the finished build (the gift), never with "I came across you on Google Maps / you don't have a website".** That deficit opener is the saturated spam-signature owners bin on sight (it translates into the same cliché in every language).
- **Identity is carried by `${SIGNATURE}` at the bottom — do NOT hardcode a name or job title in the opening.** The operator may not be a "developer", and `${OPERATOR_NAME}` may be a business name rather than a person.
- **`{photo line}` and `{personalisation hook}` are each ONE complete, self-contained sentence** (see below). They sit back-to-back between the link and the price line, so the body reads naturally in every combination: both present, hook-only (no photos), or the generic fallback. **Never** fuse the hook onto the photo sentence with "and" (it breaks the grammar — see the Personalisation hook section below).

`${PRICING}` and `${PRICING_TERMS}` are read verbatim from `.env`. `${SIGNATURE}` is read from `.env` only if set; otherwise the sign-off is composed at message time per the SIGNATURE rule above. Substitute the actual values (resolved or composed) when composing each message; do not send the literal placeholders.

### Rescue leads — the observation takes the hook slot

If this client's mode is `rescue` (Supabase `extra.mode`, mirrored in status.md), two changes:

1. The opening (and the email subject) says "a new website": `"Hi, I built {Business Name} a new website and wanted to show you - here it is:"`
2. The personalisation-hook slot is filled by ONE factual, sympathetic observation about their current site (URL in the `website` column; `{domain}` below is its bare hostname), phrased in plain words from the recorded `site_signals` ONLY — never from fresh guessing:
   - dead / unreachable: `"Your current site at {domain} doesn't seem to load any more, so this one's ready to take its place."`
   - parked-or-suspended-page: `"{domain} is only showing a hosting placeholder right now, so this one's ready to take its place."`
   - broken-tls-cert: `"Your current site comes up with a security warning in the browser, this one won't."`
   - no-viewport-meta: `"Your current site doesn't display properly on phones, which is where most customers will see it, so I built this one mobile-first."`
   - only no-https / stale-copyright: `"It's a fresh, modern take on your current site, and everything's carried over."`
   - redirects-off-domain: `"Your web address currently just forwards to your {Facebook page / listing}, so I built you a proper site to put on it."`

Before sending ANY rescue observation, re-run `node scripts/site-check.js "URL"` — sites get fixed (and certificates renewed) between find and outreach. If the verdict is no longer `bad` or `dead`, do NOT send: the premise is gone, flag the lead for the operator instead. If the verdict changed class (e.g. `dead` at find, `bad`/`broken-tls-cert` now), use the observation matching the CURRENT signals.

Describe, never mock — sympathetic passer-by, not audit. No tech jargon ("SSL", "viewport", "responsive") and no piling up faults: one observation, then move on. Everything else is unchanged (photo line, price, sign-off, language rules). If a regular personalisation hook is also strong, the observation still wins — one hook only.

### Booking leads — booking-first wording, registry-gated variants

If this client's mode is `booking` (Supabase `extra.mode`, mirrored in status.md), the message leads with the booking system, and every platform claim is gated by the registry — never by memory or guesswork.

**Re-verify first** (both checks; skip both for `booking_signal: no_website` leads):
1. Re-run `node scripts/booking-check.js "URL"` on the stored `website` value. This catches registry corrections since find; if the verdict is no longer `booking_platform` / `dead_platform`, the premise is gone — do NOT send, flag the lead for the operator. The fresh output's `fee_line_allowed` / `fee_line_notes` are the ONLY source for fee wording.
2. The gate is offline and cannot see a website launched since find. Run one `node scripts/ddg-search.js "\"NAME\" LOCATION"` and scan for an own domain (same test as gather's Step 0a). A live own site → the "no real website" claim is false: do NOT send, flag the lead.

**By `booking_signal`** — the hook slot takes a single block (never stack extra platform lines around it). Booking messages deliberately run longer than the usual 55-80 words — the system needs selling — but stay under 150:
- `golden_check`, registry says `fee_line_allowed: true`:
  `"It comes with a complete booking system built in - clients can book straight off your website, and it can take {Platform}'s place entirely: your own system, shaped around exactly how you work, no fees on anything. Or the website can direct customers to your existing {Platform}, if you want to keep that."`
- `golden_check`, `fee_line_allowed` `false` or `"conditional"` — identical minus the fee clause:
  `"It comes with a complete booking system built in - clients can book straight off your website, and it can take {Platform}'s place entirely: your own system, shaped around exactly how you work. Or the website can direct customers to your existing {Platform}, if you want to keep that."`
  NO fee/cost wording of any kind on these platforms: many have free tiers, and one wrong "you're paying" claim kills the thread. Never cite commission percentages, and never claim their own-link bookings carry fees.
- `dead_platform`: `"The website link on your Google listing points at {Platform}, which has shut down - anyone clicking it gets nothing. This one's ready to take its place, booking system included."`
- `no_website` — standard classic opener (gift-first), plus one line: `"It's got its own booking system inside, so clients can book you straight from the site."`

**Demo-mode explanation stays OUT of message one.** If they reply asking whether the booking works / where bookings go, answer honestly then: the booking page is in demo mode on the preview; it switches on the moment they go live (confirmations, reminders, their own dashboard), or it can simply link to their current {Platform} page if they'd rather keep that. Never volunteer this in the first message and never label it on the site.

### Photo line — check the filesystem first

Before writing the message, verify the site actually has photos:
```bash
ls clients/$ARGUMENTS/site/public/images/ 2>/dev/null | grep -iE '\.(jpg|jpeg|png|webp)$' | head -5
```
- **If one or more images are listed**: the photo line is one complete, self-contained sentence: `"It's built around your own photos, not a template, so it should feel like yours."`
- **If no images are listed** (rare — happens when gather genuinely couldn't find any): OMIT the photo line entirely. Don't substitute a different claim, don't say "stock images chosen to match your industry", don't lie. Just lead straight into the personalisation hook.

The site may have photos under `clients/$ARGUMENTS/data/images/` even if the build step didn't copy them across — but what matters for the outreach claim is what the recipient will see when they click the link. Check `site/public/images/`, which is what's deployed.

### Personalisation hook — pull from gathered-content.md

Open `clients/$ARGUMENTS/data/gathered-content.md` and find the `## Personalisation hook` section (added by `/gather`). Weave it in as one complete, self-contained sentence, placed immediately after the photo sentence (or straight after the link if there are no photos). It MUST stand on its own and read naturally between the photo sentence and the price line — **never** join it to the photo sentence with "and", because the hook is usually a full clause and that breaks the grammar.

Weave it in naturally — don't quote it verbatim with markdown formatting. Examples of how to phrase the hook in the body:

- Review-quote hook: `"One of your reviews mentioned how Dave sharpens the kids' clippers between cuts, so I made sure that kind of detail comes across on the site."`
- Specific-service hook: `"I noticed you do same-day emergency callouts seven days a week, so I gave that its own section so it stands out."`
- Heritage hook: `"You've been open since 1987, so I leaned into that on the homepage."`

**If the hook section says `(no hook available — gather did not surface a specific differentiator)`**, fall back to the older generic line: `"It's got your services, real customer reviews, opening hours, and a map so customers can find you easily."` Don't invent a hook — a generic line is safer than a wrong one.

**Never** reference visual details inferred from photos ("we love the dog in your photos"), Instagram bios, or generic compliments ("great atmosphere"). The gather step has already filtered those out — if you find yourself reaching for one, you're hallucinating.

### Reputation / reviews — only when it feeds the hook

We no longer open with a reputation compliment (the message leads with the build, not flattery). But when the personalisation hook is a reviews/reputation angle, the same caution applies. Google Maps is only one of many review sites (Trustpilot, Facebook, and country-specific directories), so its count understates real reputation, and quoting a small number back at an owner sounds condescending:

- **30+ Google reviews, strong rating (4.5+)**: safe to cite the number inside the hook sentence — `"Your 4.8 stars across 60+ reviews stood out, so I gave them pride of place on the homepage."`
- **Under 30 reviews, strong rating (4.5+)**: praise the rating only, no count — `"Your reviews are excellent, so I built a few of them into the homepage."`
- **Few or no reviews**: skip reputation entirely — use a different hook (years in business, a standout service, the area served, a specific review quote).

Never invent or inflate numbers. If in doubt, drop the number and keep it qualitative.

## Rules
- **The composed message passes the `anti-ai-slop` skill before it is sent or drafted.** Invoke `Skill(skill="anti-ai-slop")` in ENFORCE mode (job A) while composing, and check the final body against its `eval.md` — it applies to the send path and to draft-only mode alike. It kills the 10 AI fingerprints, ~30 named slop patterns and 80+ banned phrases. The dash and contraction rules below are its rules, restated here because they ship most.
- No em dashes or en dashes in the message body sent to clients
- Use contractions
- Sound human, not AI
- NEVER send outreach twice to the same client
- NEVER send if Supabase already shows status `outreach_sent` or `outreach_channel` is not null
- Verify review claims match reality
- Personalisation hook MUST come from `gathered-content.md`'s `## Personalisation hook` section. Never invent a hook from your own knowledge of the business or from looking at photos — if no hook is recorded, use the generic fallback line.

## Atomic outreach flow (MANDATORY - prevents duplicate sends across parallel sessions)

### Step 1: Claim outreach BEFORE composing or sending anything
```bash
python3 -c "from scripts.db import claim_outreach; print(claim_outreach('SLUG'))"
```
- If `True`: you have the lock. Proceed to compose and send.
- If `False`: another session is handling this client's outreach. **STOP immediately.**

### Step 2: Walk the priority list and send
For each channel in `OUTREACH_PRIORITY` (in order):
  - If non-viable for this client (no relevant contact field), skip to next.
  - Attempt the send via the channel's adapter.
  - Parse the result:
    - **Success** → go to Step 3a with the channel name (and `account` if WhatsApp).
    - **Per-recipient fail** (`not_on_whatsapp`, hard bounce, undeliverable) → continue to next priority channel. No alert.
    - **Ambiguous/account-level fail** → `bash scripts/notify.sh "WhatsApp send failed for SLUG: <reason>"` (or equivalent for email/SMS), then continue to next priority channel.
  - If we exhaust the list without success → Step 3c.

### Step 3a: If a send SUCCEEDS — mark as sent
```bash
# Email:
python3 -c "from scripts.db import set_outreach_sent; set_outreach_sent('SLUG', 'email', message_id='MESSAGE_ID', subject='SUBJECT')"

# SMS:
python3 -c "from scripts.db import set_outreach_sent; set_outreach_sent('SLUG', 'sms')"

# WhatsApp (must record the account that sent — follow-ups need the same one):
python3 -c "from scripts.db import set_outreach_sent; set_outreach_sent('SLUG', 'whatsapp', account='ACCOUNT_FROM_JSON', message_id='MESSAGE_ID_FROM_JSON')"
```

The `account` value for WhatsApp comes from the shim's JSON response (`"account": "primary"`, `"account": "uk-2"`, etc.) — copy it verbatim. This locks follow-ups to the same WhatsApp number.

### Step 3b: If THIS send failed but you're cascading to the next channel
Do NOT release the claim — keep walking the priority list. Only call `release_outreach_claim` if you're aborting the entire attempt for this client (Step 3c below).

### Step 3c: If ALL priority channels were exhausted without success
Two paths:
- **Client has FB/IG** → mark as manual DM (see "Channel: Manual DM" above); the operator sends the DM themselves from their own account.
- **No social fallback** → release the claim, leave client at `deployed`. Don't mark as `unreachable` unless EVERY channel was tried and confirmed undeliverable.

```bash
python3 -c "from scripts.db import release_outreach_claim; release_outreach_claim('SLUG')"
```

Always alert (scripts/notify.sh) in this case so the operator knows the client wasn't reached:
```bash
bash scripts/notify.sh "Outreach exhausted for SLUG (no viable channel succeeded)"
```

## Field conventions
- **phone**: Always store the MOBILE number (in E.164 form, e.g. `+12025550123`) — this is the primary contact used for SMS outreach. If the business also has a landline, store it in a separate `landline` field. Never put a landline in `phone` if a mobile number is available.
- **facebook**: Always a full URL (e.g. `https://www.facebook.com/PageName`). Must be navigable directly.
- **instagram**: Always a bare handle without @ (e.g. `examplebarbershop`). DM URL is `https://www.instagram.com/{handle}/`.

Send an "outreach landed" notification (optional, pass the **slug**, NOT the business name):
```bash
scripts/outreach-notify-simple.sh {slug}
```
The script no-ops silently if no notification channel is configured in `.env`.
