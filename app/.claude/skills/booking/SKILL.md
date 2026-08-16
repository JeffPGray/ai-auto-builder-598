---
name: booking
description: Retrofit a deployed client site with a bespoke online booking system — restaurant/class slot bookings or salon-style service appointments, with instant email confirmations, calendar invites, self-service rescheduling, a staff dashboard, day-of reminders, and no monthly fees. Vercel only.
argument-hint: [business-name]
effort: high
allowed-tools: Bash(npx *), Bash(npm *), Bash(python3 *), Bash(node *), Bash(cd *), Bash(cp *), Bash(mv *), Bash(mkdir *), Bash(rm *), Bash(cat *), Bash(grep *), Bash(test *), Bash(curl *), Bash(diff *), Bash(openssl *), Bash(printf *), Bash(sleep *), Bash(kill *), Bash(pkill *), Bash(bash *), Bash(head *), Bash(cut *), Bash(tr *), Bash(touch *), Bash(sed *), Bash(perl *), Bash(xargs *), Bash(echo *), Read, Write, Edit, Glob, Grep, mcp__supabase__execute_sql, mcp__supabase__apply_migration
---

# Add a booking system to $ARGUMENTS

Read `prompts/lessons/build.md` and `prompts/lessons/deploy.md` before starting — this skill rebuilds and redeploys the client site, and those failure modes apply.

Retrofit the already-deployed site in `clients/$ARGUMENTS/site` with a bespoke booking system: customers book online and get instant email confirmations carrying a calendar invite and a self-service change-or-cancel link; the owner gets notification emails plus a password-protected staff dashboard at `/admin/bookings` (phone bookings, cancellations, closures); a morning cron sends day-of reminders. No OpenTable/Fresha-class subscription, no per-booking fees — it runs on the client's site within the free tiers the pipeline already uses.

This is a known-good architecture, proven in production. The plumbing is copied verbatim from `.claude/skills/booking/reference/`; only the seed data, the public-page styling and a handful of marked copy zones are per-site. Do not redesign the architecture.

**The contract:** the operator says `/booking acme-bistro`; you run ONE batched discovery conversation (Step 1), then install autonomously and hand back a live, self-tested booking system plus the dashboard password. Nothing between discovery and handover should need the operator.

## Two archetypes — pick ONE in discovery

| | `slot-capacity` | `appointments` |
|---|---|---|
| Fits | restaurants with sittings, supper clubs, classes, tours, events | salons, barbers, clinics, groomers, garages, studios |
| Model | fixed start times, each with a capacity that party sizes consume | services with durations, staff calendars, start times on a minute grid |
| Capacity | max headcount per slot, optionally also tables (`ceil(party/covers_per_table)`) | one appointment per staff member at a time, with per-service buffer |
| The customer picks | date → time slot → party size | service → (staff) → date → time |

Both share the same machinery: an advisory-lock create RPC (the concurrency-critical core; also reschedules atomically via `p_reschedule_of` and stamps each booking's `visit_number`), a single `*_booking_settings` row as the **single source of truth for every business rule**, closures, cutoff + advance-window logic, cancel tokens, idempotent cancellation, the seven transactional emails (confirmations carry an .ics calendar invite), demand-signal telemetry, and the admin session shared with the `/cms` skill.

## Architecture (read once, then follow the steps)

- **Database (operator's own Supabase, the same project as the CRM).** All tables are prefixed with this client's slug (`acme_bistro_bookings` …) so many client sites coexist in one project. RLS is enabled with no policies — only the service-role key (server-side on Vercel) can touch them. Business rules live in the settings row and are read at runtime by BOTH the SQL functions and the TypeScript layer — never copy a rule into code (that exact drift caused the one production bug in the system this is distilled from).
- **The create RPC** takes a `pg_advisory_xact_lock` before checking capacity/overlaps, because an empty slot has no rows to lock — two racing requests could otherwise both pass the check and double-book. Never replace the RPC with TypeScript-side checks + insert.
- **Email** is one nodemailer SMTP transport (`src/lib/booking/email.ts`); production vs POC mode is purely env values (Step 7). From display-name = the business; Reply-To routes replies to the owner's real inbox (customer mail) or the customer (owner mail).
- **Admin session** = the CMS skill's `src/lib/auth.ts` (same cookie, same `ADMIN_PASSWORD`/`SESSION_SECRET`). With `/cms` installed, one password unlocks both the editor and the bookings dashboard; without it, this skill installs the same auth files standalone.
- **Public pages** (`/book`, `/book/cancel/[token]`) are `force-dynamic` and read settings live — owner rule changes apply within ~30s with no redeploy. Reference UI ships with a neutral skin plus `booking-restyle` markers: restyle classes/copy to match the site, never the logic.

## Step 0 — Preconditions (STOP gates)

1. **Host must be Vercel.** `grep -E '^DEPLOY_PROVIDER=' .env | head -1 | cut -d= -f2- | tr -d '"'` — if `cloudflare` or `netlify`, **STOP**: the booking system needs server routes, runtime env and Vercel cron. No partial install.
2. **The site must exist and be deployed.** `test -d clients/$ARGUMENTS/site` and a `deployed_url` in Supabase (`python3 scripts/db.py client $ARGUMENTS`). If built but not deployed, run `/deploy $ARGUMENTS` first.
3. **Not already booking-enabled.** If `clients/$ARGUMENTS/data/booking.md` exists — do NOT reinstall; switch to § Maintenance. If `data/booking-in-progress` exists without `booking.md`, a previous run failed partway — resume from where it stopped (every step is safe to re-run).
4. **No CMS install mid-flight.** If `data/cms-in-progress` exists, STOP and tell the operator to let the CMS install finish first.
5. **Supabase MCP must be reachable** (`mcp__supabase__execute_sql` with `SELECT 1`). The schema is applied through it.
6. **Note the Next/React versions** from `clients/$ARGUMENTS/site/package.json`. Next ≥ 16 → `src/proxy.ts`; Next ≤ 15 → `src/middleware.ts` (same body, export renamed `middleware`). React ≤ 18 → `useFormState` instead of `useActionState` in `LoginForm.tsx`. Applies only when this skill installs the auth files (Step 4).
7. **Owner-facing language is `${OPERATOR_LANGUAGE}`** from `.env` (falls back to English). Everything a customer or owner reads — booking form, emails, dashboard, cancel pages, the handover note — must be written in it. Reference files ship in English; translate their user-facing strings after copying.
8. **Booking-facade site?** If this client's `extra.mode` is `booking` (status.md or Supabase), the site carries the demo booking facade — this install REPLACES it. Before Step 4's copies: delete the facade components (its `/book` page or `#book` homepage section and any facade-only helpers) and repoint every booking CTA at the real `/book`. In Step 5.2's diff gate the facade removal is expected — don't "restore" facade copy the diff shows as missing.
9. **Capture the before-state** of the live site now, before anything is touched (used by Step 6's identity check):
   ```bash
   npx playwright-cli -s=booking open
   npx playwright-cli -s=booking goto "$DEPLOYED_URL"
   npx playwright-cli -s=booking eval "document.body.innerText" > /tmp/booking-before-$ARGUMENTS.txt
   ```
10. **Drop the in-progress marker** so a parallel `/build` can't clobber this client mid-install: `touch clients/$ARGUMENTS/data/booking-in-progress`. Removed at Step 9.

## Step 1 — Discovery (ONE batched conversation)

Before asking anything, mine what the pipeline already knows: `clients/$ARGUMENTS/data/gathered-content.md` (opening hours, services, prices, staff names), the live site, and `python3 scripts/db.py client $ARGUMENTS` (industry, contact details). Present what you inferred and ask the operator to confirm/correct **in one message** — never a question at a time. Cover:

1. **Archetype** — propose it from the industry (restaurant/class → slot-capacity; salon/clinic/barber → appointments) and confirm.
2. **Demo or converted client?** Demo = the operator is using this to pitch; converted = the business is live and paying. This decides where owner notifications go (Step 2) and the email mode (Step 7).
3. **Slot-capacity:** service days; slot start times + duration; max covers per slot; table model (tables per slot + covers per table) or headcount-only; min/max party.
   **Appointments:** services (name, duration, buffer, display price); staff (or "just the business" — seed one staff row, the form hides the picker); working hours per staff per weekday; grid granularity (default 15 min).
4. **Policies** — advance window (default 30 days), cutoff hours (default: 6 for slot-capacity, 2 for appointments), booking-ref prefix (2–3 letters from the business name).
5. **Locale bits** — IANA timezone (propose from `OPERATOR_COUNTRY_CODE`: GB→Europe/London, ES→Europe/Madrid, IT→Europe/Rome, FR→Europe/Paris, DE→Europe/Berlin, US→ask which; always confirm), display locale (e.g. `en-GB`, `it-IT`), business phone/address as they should appear in emails.
6. **Owner's notification inbox** — the address that receives new-booking/cancellation emails. For a **demo**, this is the OPERATOR's `${EMAIL_ADDRESS}` (the owner doesn't know yet; the operator demos the flow from their own inbox). For a **converted client**, the owner's real inbox.
7. **Email mode** — does this client have their own custom domain (converted clients usually do)? Yes → production mode (Resend, `bookings@theirdomain`, Step 7A; needs `RESEND_API_KEY` in `.env` — free account, flag it now if missing so signup happens during discovery, not mid-install). No → POC mode (operator's own mailbox sends, Step 7B).

Record every answer in `clients/$ARGUMENTS/data/booking-spec.md`, then proceed autonomously.

## Step 2 — Apply the database schema (Supabase MCP)

```bash
# NOTE: shell variables do NOT persist between tool invocations. Re-derive
# PREFIX with these exact lines in ANY later shell that needs it (Step 4.1
# repeats them) — never assume it's still set.
# The cut caps the prefix at 30 chars: Postgres silently truncates
# identifiers at 63 bytes, and the longest generated suffix
# (appointments_date_staff_status) is 30 — a long slug would otherwise store
# truncated function names the TS then can't call.
PREFIX=$(echo "$ARGUMENTS" | tr 'A-Z' 'a-z' | tr '-' '_' | tr -cd 'a-z0-9_' | cut -c1-29 | sed 's/_*$//')_
case "$PREFIX" in [0-9]*) PREFIX="b_$PREFIX";; esac   # SQL identifiers can't start with a digit
test -n "${PREFIX%_}" || { echo "EMPTY PREFIX — STOP"; exit 1; }
VARIANT=slot-capacity   # or: appointments
sed "s/biz_/${PREFIX}/g" .claude/skills/booking/reference/$VARIANT/schema.sql > /tmp/booking-schema-$ARGUMENTS.sql
```

Edit `/tmp/booking-schema-$ARGUMENTS.sql`: fill every `booking-generate` seed value from the spec (settings row; for appointments also the services / staff / staff_services / staff_hours seeds). Then apply the whole file via `mcp__supabase__apply_migration` (name it `booking_${PREFIX%_}` — snake_case only, no hyphens; fall back to `mcp__supabase__execute_sql` if migrations aren't available). Verify the seeds actually landed with the spec's values — placeholder leftovers here are the highest-stakes silent failure:

```sql
SELECT business_name, business_email, business_phone, timezone, locale, ref_prefix
FROM <prefix>booking_settings;   -- 1 row; every value from booking-spec.md, no 'owner@example.com' leftovers
-- appointments installs: also sanity-check the catalogue
-- SELECT name, duration_minutes, buffer_minutes, price_label FROM <prefix>services;
-- SELECT name FROM <prefix>staff;
```

The seeds are guarded (`ON CONFLICT DO NOTHING` / only-when-empty), so re-running after a partial failure never clobbers rows the owner has since edited — which also means **re-applying never corrects a wrong seed**: if a seeded value is wrong, fix it with an `UPDATE` (or `DELETE` + `INSERT` for catalogue rows) via `mcp__supabase__execute_sql`, not by editing the file and re-applying.

## Step 3 — Flip the runtime + install deps

```bash
cd clients/$ARGUMENTS/site
npm install
rm -rf out
# Flip off static export ONLY if nothing has flipped it yet — a cms or
# google-rating retrofit may already own this config; never clobber theirs:
grep -q "output: 'export'" next.config.mjs \
  && cp ../../../.claude/skills/cms/reference/next.config.mjs next.config.mjs \
  || echo "config already server-shaped — leaving it"
npm install @supabase/supabase-js nodemailer zod
npm install -D @types/nodemailer
```

Same non-negotiables as the CMS flip: **no** `output: 'export'`, keep `images: { unoptimized: true }`. If the scaffold config had extra custom keys (rare), merge them into the new file rather than losing them.

## Step 4 — Copy the plumbing (verbatim) + prefix substitution

From the project root, with `VARIANT` from Step 2:

```bash
SITE=clients/$ARGUMENTS/site
REF=.claude/skills/booking/reference
mkdir -p $SITE/src/lib/booking \
  "$SITE/src/app/api/booking/availability" "$SITE/src/app/api/booking/cancel" \
  "$SITE/src/app/api/booking/reschedule" \
  "$SITE/src/app/api/booking/cron-reminders" "$SITE/src/app/api/booking/admin/closures" \
  "$SITE/src/app/api/booking/admin/[id]" "$SITE/src/app/book/cancel/[token]" \
  "$SITE/src/app/admin/bookings"

for f in supabase security dates tokens email admin-session; do
  cp $REF/shared/$f.ts $SITE/src/lib/booking/$f.ts
done
for f in settings demand emails; do
  cp $REF/$VARIANT/$f.ts $SITE/src/lib/booking/$f.ts
done
cp $REF/$VARIANT/api-availability-route.ts       $SITE/src/app/api/booking/availability/route.ts
cp $REF/$VARIANT/api-booking-route.ts            $SITE/src/app/api/booking/route.ts
cp $REF/$VARIANT/api-cancel-route.ts             $SITE/src/app/api/booking/cancel/route.ts
cp $REF/$VARIANT/api-reschedule-route.ts         $SITE/src/app/api/booking/reschedule/route.ts
cp $REF/$VARIANT/api-admin-booking-id-route.ts   "$SITE/src/app/api/booking/admin/[id]/route.ts"
cp $REF/$VARIANT/api-closures-route.ts           $SITE/src/app/api/booking/admin/closures/route.ts
cp $REF/$VARIANT/api-cron-reminders-route.ts     $SITE/src/app/api/booking/cron-reminders/route.ts
cp $REF/$VARIANT/book-page.tsx                   $SITE/src/app/book/page.tsx
cp $REF/$VARIANT/BookingForm.tsx                 $SITE/src/app/book/BookingForm.tsx
cp $REF/$VARIANT/cancel-page.tsx                 "$SITE/src/app/book/cancel/[token]/page.tsx"
cp $REF/$VARIANT/RescheduleForm.tsx              "$SITE/src/app/book/cancel/[token]/RescheduleForm.tsx"
cp $REF/shared/CancelConfirm.tsx                 "$SITE/src/app/book/cancel/[token]/CancelConfirm.tsx"
cp $REF/$VARIANT/admin-bookings-page.tsx         $SITE/src/app/admin/bookings/page.tsx
cp $REF/$VARIANT/BookingsDashboard.tsx           $SITE/src/app/admin/bookings/BookingsDashboard.tsx
```

**Admin auth — reuse the CMS's if present, install it standalone if not:**

```bash
if [ ! -f $SITE/src/lib/auth.ts ]; then
  CMSREF=.claude/skills/cms/reference
  cp $CMSREF/auth.ts $SITE/src/lib/auth.ts
  cp $CMSREF/proxy.ts $SITE/src/proxy.ts            # Next ≤15: src/middleware.ts + rename export (Step 0.6)
  mkdir -p $SITE/src/app/admin/login
  cp $CMSREF/login-page.tsx  $SITE/src/app/admin/login/page.tsx
  cp $CMSREF/LoginForm.tsx   $SITE/src/app/admin/login/LoginForm.tsx
  cp $CMSREF/admin-error.tsx $SITE/src/app/admin/error.tsx
  cp $REF/shared/actions-login-only.ts $SITE/src/lib/actions.ts
fi
```

(If `/cms` is added later, its `actions.ts` replaces the login-only one — safe by design, the login/logout signatures match. If the CMS is already installed, skip this whole block; do NOT overwrite its files.)

**Resume caveat:** re-running the `cp` block above resets everything steps 4.1–4.4 and 5.1 produce (prefix substitution, marker fills, translations, the restyle). If you re-copy after any of those steps, redo them all.

Then:

1. **Prefix substitution** across the copied TS (table names ship as `biz_…`). Re-derive `$PREFIX` here — shell state does NOT survive between tool invocations, and an EMPTY `$PREFIX` would silently strip the markers instead of renaming them, breaking every DB call:
   ```bash
   SITE=clients/$ARGUMENTS/site
   PREFIX=$(echo "$ARGUMENTS" | tr 'A-Z' 'a-z' | tr '-' '_' | tr -cd 'a-z0-9_' | cut -c1-29 | sed 's/_*$//')_
   case "$PREFIX" in [0-9]*) PREFIX="b_$PREFIX";; esac
   test -n "${PREFIX%_}" || { echo "EMPTY PREFIX — STOP"; exit 1; }
   grep -rl "biz_" $SITE/src | while read -r f; do perl -pi -e "s/biz_/${PREFIX}/g" "$f"; done
   grep -rn "biz_" $SITE/src && echo "SUBSTITUTION INCOMPLETE — investigate" || echo "prefix substitution clean"
   ```
   (The while-read loop is deliberate: on a re-run with nothing left to substitute, a bare `xargs perl -pi` would hang forever on GNU/Linux waiting on stdin.)
2. Confirm `tsconfig.json` maps `"@/*"` → `"./src/*"`.
3. Fill the `booking-generate` markers: metadata titles (business name), the `ACCENT` constant in `emails.ts` (the site's primary brand colour), email wording tweaks for the business type. **Delete each marker comment as you fill it** — Step 6 greps for leftovers and must come back clean.
4. Translate user-facing strings to `${OPERATOR_LANGUAGE}` (Step 0.7) — form, emails, dashboard, cancel pages, login page.
5. Standalone installs only (no CMS): the dashboard header has a "Site admin" link to `/admin` — remove it or point it at `/` (there's no `/admin` home without the CMS).

## Step 5 — Restyle + wire the site to /book

1. **Restyle the public pages** (`book-page.tsx`, `BookingForm.tsx`, `cancel-page.tsx`, `RescheduleForm.tsx`, `CancelConfirm.tsx`): swap the neutral classes for the site's design system — its fonts, palette, buttons, radii — so `/book` feels native, and give the book page the site's header/nav/footer. **Classes and copy only; every `booking-restyle` comment marks the boundary. Never touch the logic.** The dashboard keeps its neutral skin. **The emails carry the site's design language too:** restyle the HTML building blocks in `src/lib/booking/email.ts` (`emailShell`, `detailRow`, `refBadge`, `ctaButton`) to echo the site — palette, rules/borders, letterspacing, and the closest **email-safe system font stack** to the site's faces (a Didot/Bodoni/Georgia stack for a high-contrast serif, Helvetica/Arial for a grotesque; never webfonts, never external assets). Inline CSS only; keep the existing HTML structure and every placeholder intact — restyle presentation, never plumbing.
2. **Back up, then add the entry points** to the existing pages:
   ```bash
   # multi-page sites: the nav lives in shared chrome, so back THAT up, not the home page
   test -f clients/$ARGUMENTS/data/nav.pre-booking.bak || \
     cp "$(test -f $SITE/src/app/_components/SiteNav.tsx && echo $SITE/src/app/_components/SiteNav.tsx || echo $SITE/src/app/page.tsx)" \
        clients/$ARGUMENTS/data/nav.pre-booking.bak
   ```
   (CMS sites: the rendered page is `HomeView.tsx` — back that up instead. Sites with no `_components/SiteNav.tsx` carry the nav inline in each `page.tsx`; add the Book link to every one of them, or the link appears on the home page only.) Add a "Book" link to the nav and, where the design has an obvious primary CTA (hero button, contact section), point it at `/book`. Keep changes minimal and in the site's own idiom. On CMS sites these are design furniture — do NOT add them to the content model.

## Step 6 — Build + identity check

```bash
grep -rn "booking-generate" clients/$ARGUMENTS/site/src && echo "MARKERS REMAIN — finish Step 4.3" || echo "clean"
cd clients/$ARGUMENTS/site
npx next build
```

Fix until clean, then prove the retrofit changed nothing it shouldn't have:

```bash
npx next start -p 3113 & echo $! > /tmp/booking-next-$ARGUMENTS.pid
sleep 6
npx playwright-cli -s=booking open
npx playwright-cli -s=booking goto "http://localhost:3113"
npx playwright-cli -s=booking eval "document.body.innerText" > /tmp/booking-after-$ARGUMENTS.txt
npx playwright-cli -s=booking goto "http://localhost:3113/book"
npx playwright-cli -s=booking eval "document.body.innerText.slice(0, 400)"   # form renders (needs env; DB errors are OK locally — see below)
kill "$(cat /tmp/booking-next-$ARGUMENTS.pid)" 2>/dev/null || pkill -f "next start -p 3113" || true
diff <(tr -s '[:space:]' ' ' < /tmp/booking-before-$ARGUMENTS.txt) <(tr -s '[:space:]' ' ' < /tmp/booking-after-$ARGUMENTS.txt)
```

The diff must show ONLY the additions you intended in Step 5.2 (the "Book" nav label / CTA text) — nothing removed, nothing else changed. If existing copy changed, fix it; don't rationalise. **Exception — sites with the cms or auto-updating-google-rating skill installed:** the live before-state renders owner-edited Blob content / live Google numbers, while the local run (no Blob token / Places key) renders install-time defaults — those diffs are PRE-EXISTING, not yours. Verify only that the booking additions are as intended, and do NOT "fix" content differences to match either side (the owner's edits are the truth); if a difference doesn't clearly belong to either category, STOP and flag it to the operator. (`/book` itself may error locally without `SUPABASE_URL` in the shell — that's fine, Step 8 verifies it live; you can also export the env vars from `.env` before `next start` to test it fully here.)

## Step 7 — Vercel wiring (secrets + email mode)

Link + assert first (never skip):

```bash
cd clients/$ARGUMENTS/site
rm -rf .vercel
npx vercel link --token=$VERCEL_TOKEN ${VERCEL_SCOPE:+--scope=$VERCEL_SCOPE} --yes --project $ARGUMENTS
cat .vercel/project.json | python3 -c "import sys,json; p=json.load(sys.stdin); assert p['projectName']=='$ARGUMENTS', f'WRONG PROJECT: {p[\"projectName\"]}'; print('linked correctly')"
npx vercel env ls production --token=$VERCEL_TOKEN
```

Set each var via stdin (`printf '%s' "VALUE" | npx vercel env add NAME production --token=$VERCEL_TOKEN`), skipping any that `env ls` already shows:

- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` — copy the values from the pipeline `.env`. Runtime-only; never `NEXT_PUBLIC_*`, never printed, never in any file.
- `ADMIN_PASSWORD`, `SESSION_SECRET` — same rules as the CMS skill: if `ADMIN_PASSWORD` exists, do NOT overwrite (the recorded password is in `cms.md`/`booking.md`; if it exists but neither file does, `env rm` + fresh). New password = three unrelated lowercase words + two digits (`maple-river-frost-42`), never derived from the business name. `SESSION_SECRET` = `openssl rand -hex 32`, machine-only.
- `CRON_SECRET` = `openssl rand -hex 32`, machine-only (Vercel automatically sends it as the Bearer token on cron invocations). Step 8.7's self-test needs the VALUE, and shell state doesn't persist between tool invocations — either run generate + `env add` + the Step 8.7 curl in one Bash invocation, or recover it later with `npx vercel env pull /tmp/booking-env-$ARGUMENTS.txt --environment=production --yes --token=$VERCEL_TOKEN`, grep `CRON_SECRET` from that file, and `rm` the file immediately.
- The four SMTP vars + `BOOKING_FROM_EMAIL`, per the email mode from discovery:

**7A — Production mode (client has a custom domain; Resend):** requires `RESEND_API_KEY` in the pipeline `.env` (free tier: 1 verified domain, ~3,000 emails/month — the operator signed up during discovery if needed).

1. Create the domain in Resend: `curl -s -X POST https://api.resend.com/domains -H "Authorization: Bearer $RESEND_API_KEY" -H "Content-Type: application/json" -d '{"name":"<clientdomain>"}'` → note the domain `id` and the `records` array (DKIM/SPF).
2. Add each record to DNS. If the domain runs on Vercel DNS (the pipeline's custom-domain setup does; confirm with `npx vercel dns ls <clientdomain> --token=$VERCEL_TOKEN`): `npx vercel dns add <clientdomain> <record-name> <TYPE> <value> --token=$VERCEL_TOKEN` for each — **except the MX record**, which needs its priority as a trailing argument: `npx vercel dns add <clientdomain> <record-name> MX <value> <priority> --token=$VERCEL_TOKEN` (Resend's response includes the priority, typically 10). Otherwise print the records and ask the operator to add them at their DNS host, then continue.
3. Trigger verification (`curl -s -X POST https://api.resend.com/domains/<id>/verify -H "Authorization: Bearer $RESEND_API_KEY"`) and poll `GET /domains/<id>` until `status` is `verified` (typically a few minutes; STOP and alert if still unverified after ~15).
4. Env values: `BOOKING_SMTP_HOST=smtp.resend.com`, `BOOKING_SMTP_PORT=465`, `BOOKING_SMTP_USER=resend`, `BOOKING_SMTP_PASS=<RESEND_API_KEY>`, `BOOKING_FROM_EMAIL=bookings@<clientdomain>`.

**7B — POC mode (no domain yet; the operator's own mailbox sends):** copy from the pipeline `.env`: `BOOKING_SMTP_HOST=$EMAIL_SMTP_HOST`, `BOOKING_SMTP_PORT=$EMAIL_SMTP_PORT`, `BOOKING_SMTP_USER=$EMAIL_ADDRESS`, `BOOKING_SMTP_PASS=$EMAIL_PASSWORD`, `BOOKING_FROM_EMAIL=$EMAIL_ADDRESS`. Customers will see the operator's address behind the business display name — acceptable for a demo, **not for a live paying client**; the upgrade to 7A is part of the conversion checklist in `booking.md`.

**Cron config:** still inside `clients/$ARGUMENTS/site` from the link step, so use the site-relative path: `cp ../../../.claude/skills/booking/reference/shared/vercel-cron.json vercel.json` (merge the `crons` key if a `vercel.json` already exists). Adjust the schedule so it fires ~09:00 in the client's timezone (the field is UTC; e.g. Europe/London → `0 8 * * *` in winter — pick the UTC hour that's 9am local most of the year, a ±1h DST drift is fine for reminders). Vercel Hobby allows daily crons — this fits free.

## Step 8 — Deploy + live self-test

Deploy via the deploy skill (`/deploy $ARGUMENTS`) — never hand-rolled. The env vars reach the live site at runtime.

Then prove the whole system live. **Rule: test bookings use the operator's own `${EMAIL_ADDRESS}` as the customer email and "Klaudius Test" as the name — NEVER a real customer's or the owner's details.** In demo installs the owner-notification inbox is already the operator's address. **In converted installs, temporarily repoint it for the test** (`UPDATE <prefix>booking_settings SET business_email = '<operator EMAIL_ADDRESS>' WHERE id = 1;` via the Supabase MCP), then **switch it back to the owner's real inbox immediately after Step 8.8 and verify with a SELECT** — forgetting the switch-back means the owner never receives booking notifications.

```bash
# Set BASE in EVERY shell you use during this step (shell state doesn't
# persist): the deployed URL from `python3 scripts/db.py client $ARGUMENTS`.
BASE=<deployed_url>
# 1. Availability responds
curl -sS "$BASE/api/booking/availability?date=<valid-future-date>&party=2" | head -c 400        # slot-capacity
curl -sS "$BASE/api/booking/availability?date=<date>&service=<service-uuid>" | head -c 400     # appointments
# (appointments: get <service-uuid> via mcp__supabase__execute_sql: SELECT id, name FROM <prefix>services;)
# 2. Create a REAL test booking (Origin header required — the API rejects curl without it)
curl -sS -X POST "$BASE/api/booking" -H "Content-Type: application/json" -H "Origin: $BASE" \
  -d '{"date":"<date>","slotTime":"<slot>","partySize":2,"name":"Klaudius Test","phone":"+441234567890","email":"<OPERATOR EMAIL_ADDRESS>","specialRequests":"skill self-test","website":""}'
# (appointments: date/startTime/serviceId/staffId:null/name/phone/email/notes/website)
# → save bookingRef + cancelUrl from the response
```

3. **Emails arrived:** check the operator's inbox — expect the customer confirmation AND the owner notification. Allow a couple of minutes for delivery, and search by the right subjects: the confirmation subject contains the BUSINESS name, only the owner notification contains "Klaudius Test" (`python3 scripts/gmail.py search --query 'SUBJECT "Klaudius Test"'` — IMAP query syntax; if it returns nothing, retry after a minute or read the inbox directly before concluding failure). Confirm the customer confirmation carries the **.ics calendar attachment** and the owner notification carries the **History line** ("First-time customer"). If still nothing: `npx vercel logs` only streams NEW log lines, so attach it in a background shell FIRST, then re-trigger a send (create + cancel another test booking), and look for `[EMAIL_FAILED]`. Fix before continuing.
4. **Dashboard:** `curl -sS -o /dev/null -w '%{http_code}' "$BASE/admin/bookings"` → 307/302 (redirect to login). Then log in headlessly (same flow as the cms skill's Step 10, password from Step 7) and confirm the dashboard shows the test booking. Note: on a CMS-enabled site, login lands on `/admin` (the CMS editor) — navigate on to `/admin/bookings`.
5. **Reschedule flow:** `curl -sS -X POST "$BASE/api/booking/reschedule" -H "Content-Type: application/json" -H "Origin: $BASE" -d '{"token":"<token from cancelUrl>","date":"<different valid date>","startTime":"<free time>"}'` (slot-capacity: `"slotTime"` instead of `"startTime"`) → `success:true` with a NEW `bookingRef` + `cancelUrl` — **use this new token for step 6**. The old token still resolves but its booking is cancelled, so a cancel POST with it returns `alreadyCancelled:true` WITHOUT exercising the real cancel path — testing with it would pass step 6 vacuously. Both "moved" emails arrive; the old booking shows `cancelled` with reason `Rescheduled to <new ref>` in the dashboard/DB.
6. **Cancel flow:** `curl -sS -X POST "$BASE/api/booking/cancel" -H "Content-Type: application/json" -H "Origin: $BASE" -d '{"token":"<token from the RESCHEDULE response>"}'` → `success:true`; both cancellation emails arrive; re-POST → `alreadyCancelled:true` (idempotency).
7. **Cron:** `curl -sS -H "Authorization: Bearer $CRON_SECRET" "$BASE/api/booking/cron-reminders"` → `{"ok":true,…}`.
8. **Clean up:** delete the test rows (both the rescheduled-away row and the final one) via `mcp__supabase__execute_sql`: `DELETE FROM <prefix>bookings WHERE customer_name = 'Klaudius Test';` (appointments: `<prefix>appointments`). Leave demand-signal rows; they're harmless.

Any failure here gets fixed and re-tested — never hand over an unverified booking system.

## Step 9 — Record + handover

1. Write `clients/$ARGUMENTS/data/booking.md`: archetype + table prefix; the `/book` and `/admin/bookings` URLs; the dashboard password (or "shared with CMS — see cms.md"); email mode (production `bookings@domain` / **POC — operator mailbox, upgrade before go-live**) and the owner-notification inbox; a settings snapshot (days/slots/capacity or services/staff, cutoff, advance window, timezone); cron schedule; the **conversion checklist** for POC installs (buy domain → Resend domain + DNS + verify → swap the five email env vars → `UPDATE <prefix>booking_settings SET business_email = '<owner inbox>'` → redeploy); and the warnings from § Rules. Then `rm -f clients/$ARGUMENTS/data/booking-in-progress`.
2. Append to `clients/$ARGUMENTS/data/status.md`: `Booking system enabled <date> — /book live, dashboard at <url>/admin/bookings, details in booking.md`.
3. Final message to the operator: both URLs, the password, what was self-tested, the email mode (and its upgrade step if POC), plus a short ready-to-forward note for the business owner in `${OPERATOR_LANGUAGE}` ("Your website now takes bookings at …/book. Customers get instant confirmation emails with a calendar invite, and can change or cancel their booking themselves up to N hours before. You manage everything at …/admin/bookings — password: … . You'll get an email for every new booking, marked first-time or returning customer.").

## Rules

- **Vercel only.** Server routes + runtime env + cron. Stop at Step 0 on any other host.
- **`/build` must never re-run for this client** — it would delete the entire booking system. The build skill checks `booking.md` / `booking-in-progress` and refuses.
- **The settings row is the single source of truth.** Every rule change is an `UPDATE` to it (§ Maintenance) — never a code edit, never a second copy of a value in TS or SQL function bodies.
- **Never bypass the create RPC** (TypeScript-side capacity checks + plain INSERT reintroduce the double-booking race), and never remove the advisory lock, the conditional-UPDATE cancel guard, or the `Promise.allSettled` around email sends (fire-and-forget emails get killed when the serverless function returns).
- **Rescheduling goes through the create RPC's `p_reschedule_of` — never client-side create-then-cancel.** The in-transaction cancel is what lets a same-staff 14:00 → 14:30 move succeed (the old appointment would otherwise block it), lets same-day moves pass the per-day cap, and means the customer can never lose the old time without gaining the new one.
- **Every admin API route verifies the session itself** — the proxy gate protects pages only. Any new admin endpoint starts with `isAdminAuthenticated()`.
- **Test traffic goes only to the operator** (`${EMAIL_ADDRESS}`, name "Klaudius Test"), and test rows are deleted after (Step 8.8).
- **Honest availability only.** Never fabricate scarcity ("only 2 left" appears only when genuinely true) and never show times that aren't real.
- **Customer PII.** Booking tables hold real customers' names, phones and emails **in the operator's Supabase project** — the operator is the data controller. Keep the service key server-side; never log PII; if the business relationship ends, offer to export their rows and delete them.
- **The service-key trust boundary.** The `SUPABASE_SERVICE_KEY` placed on a client's Vercel project can read the operator's ENTIRE Supabase project — every client's bookings AND the CRM. The per-client table prefix is a naming convention, not a security boundary. **Never grant the business owner (or anyone else) access to the Vercel project or its env vars.** If the key ever leaks, rotate it in the Supabase dashboard and update every project that uses it.
- **Abuse honesty.** The public form's defenses (honeypot, origin check, per-IP rate limit, the `max_per_customer_per_day` cap in settings) stop accidental duplicates and casual abuse — NOT a determined attacker rotating IPs and emails. If a client ever suffers targeted booking spam, that's the moment to add a CAPTCHA (bespoke work); don't promise the form is spam-proof.
- **Cost honesty:** free at small-business volume — Supabase free tier (shared with the CRM), Resend free tier (~3,000 emails/month, ~100/day), Vercel Hobby (daily cron included). An operator with many booking clients shares the Resend pot across one verified domain per client. Don't promise "unlimited".
- If anything fails irrecoverably, alert via `bash scripts/notify.sh "booking $ARGUMENTS: <reason>"` and stop — don't leave the site half-converted silently. Rollback before Step 8: restore the nav backup from Step 5.2, delete `src/app/book`, `src/app/api/booking`, `src/app/admin/bookings`, `src/lib/booking` (plus the auth files ONLY if this run added them), revert `next.config.mjs` to the scaffold (`output: 'export'`) only if NEITHER the cms nor the auto-updating-google-rating skill is installed (both need the server shape), and drop the `<prefix>` tables only with the operator's explicit OK.

## § Maintenance (the site already has a booking system)

Rule changes are DATABASE UPDATES via `mcp__supabase__execute_sql` — live within ~30s, **no redeploy**:

- **Hours / capacity / party sizes / cutoff / advance window / per-customer cap / contact details** (slot-capacity): `UPDATE <prefix>booking_settings SET max_covers_per_slot = 24, cutoff_hours = 4 WHERE id = 1;` — any column, same pattern. Existing bookings are never touched by rule changes; if capacity shrinks below what's already booked, new bookings simply stop until attrition catches up.
- **Renaming slot times or switching capacity modes** (slot-capacity) needs a DATA migration alongside the settings UPDATE — bookings store their slot as text, so a renamed slot orphans existing bookings from capacity counting (physical double-sell risk). Renaming `'18:00'` → `'18:30'`: `UPDATE <prefix>bookings SET slot_time = '18:30' WHERE slot_time = '18:00' AND booking_date >= CURRENT_DATE AND status = 'confirmed';` in the same pass as the settings change. Turning on table mode later: backfill `UPDATE <prefix>bookings SET tables_consumed = CEIL(party_size::numeric / <covers_per_table>) WHERE tables_consumed IS NULL AND status = 'confirmed' AND booking_date >= CURRENT_DATE;` — otherwise old bookings count as zero tables and the room oversells.
- **Services / staff / working hours** (appointments): `INSERT`/`UPDATE` on `<prefix>services`, `<prefix>staff`, `<prefix>staff_hours`, `<prefix>staff_services`. Deactivate rather than delete (`is_active = false`) — appointments reference these rows. New staff need hours rows AND `staff_services` links or they'll never appear.
- **One-off closures** (holiday, private event, staff sick day): the owner does this in the dashboard — no SQL, no operator involvement.
- **POC → production email** (client converted): run the conversion checklist recorded in `booking.md` (domain → Resend → env swap → `business_email` → redeploy via `/deploy`).
- **Upgrading an install made before reschedule/calendar-invite/visit-count support** (its `<prefix>appointments`/`<prefix>bookings` table has no `visit_number` column): re-apply the variant's whole `schema.sql` (prefix-substituted — it's idempotent: the `ADD COLUMN IF NOT EXISTS` shim adds the column, the seeds are guarded, and the function DROPs prevent overload buildup; if applying via `execute_sql` rather than a migration, finish with `NOTIFY pgrst, 'reload schema';` so PostgREST picks up the new signatures). Then `mkdir -p src/app/api/booking/reschedule`, copy the two NEW files (`api-reschedule-route.ts` → that dir's `route.ts`, `RescheduleForm.tsx` → `src/app/book/cancel/[token]/`), re-copy the Step 4 files that differ from the site's copies (diff to find them), redo prefix substitution + translation + restyle on all of those, rebuild, redeploy, re-run the Step 8 self-test.
- **Forgotten password:** same flow as the cms skill (read from `booking.md`/`cms.md`; only if truly lost, `env rm` + fresh + redeploy + update the records). Remember the password is shared with the CMS when both are installed.
- **Bespoke extensions** (deposits/prepayment, per-guest pre-orders, SMS reminders, waitlists): genuinely custom work — quote it separately, build it on top of these invariants (everything transactional goes inside the RPCs; every rule into the settings row or its own table).
- After any maintenance change, re-run the relevant slice of the Step 8 self-test and update `booking.md`.
