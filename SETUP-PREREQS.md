# Klaudius prerequisites — what already exists vs what `init` will create

Verified 2026-08-15 against the real Gray Reserve accounts, so the `init` wizard is answered from
fact rather than guesswork and does not create duplicates of things that already exist.

| Prereq | State | Detail |
|---|---|---|
| **Vercel** | ✅ EXISTS — reuse | CLI authed as `jeffpgray`. Team `team_i8ra4hL0aEUCXmNX82Pey5WE`. Do NOT create a new account. |
| **Supabase** | ⚠️ NEW — will be created | Gray Reserve does **not** use Supabase anywhere. The platform runs **Neon + Drizzle**. This is a genuinely new datastore, not a reuse. |
| **Google Places** | ❌ BLOCKED — do not rely on it | `GOOGLE_PLACES_API_KEY` is billing-blocked on this account (Places API New: 403 `PERMISSION_DENIED`; legacy: `REQUEST_DENIED` "must enable Billing"). Google would not let Jeff enable billing at all. If Klaudius lead-finding depends on Places, it will fail the same way — check whether it uses OSM/Overpass (which GR-185 fell back to, free and keyless) before assuming lead discovery works. |
| **Sending mailbox** | ✅ EXISTS — reuse, warmed | `access@grayreserve.com` sends today via `sendGmailAs` (Charlie Williams persona). Rohan's own recommendation is to keep sending on a mailbox you control and warm rather than routing cold volume through a shared LeadConnector pool. |

## Two consequences worth deciding before the wizard runs

**A second database.** Klaudius ships a Supabase pipeline schema. The platform's own prospect data
lives in Neon (`outbound_prospects`, `demo_builds`, `audit_log`). Running both means two sources of
truth for "which prospects have we contacted." Rohan's guidance — keep the vendor DB as source of
truth and treat GHL as the mirror — resolves it for the Klaudius lane, but the two lanes will not
see each other's prospects. Decide deliberately whether that is acceptable or whether one lane
should own sourcing.

**Lead discovery may hit the same Google wall GR-185 already hit.** GR-185's primary discovery is
OSM Overpass (free, keyless, datacenter-safe) precisely BECAUSE Places is billing-blocked here.
Worth checking Klaudius's `find` skill for its data source early — if it assumes Places, that is a
blocker on the same account limitation, not a Klaudius defect.
