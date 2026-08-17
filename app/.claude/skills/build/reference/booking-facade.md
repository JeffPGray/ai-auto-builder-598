<!--
Split out of build/SKILL.md 2026-08-16 (Fable token-cost review). Read this ONLY when this
client's extra.mode is `booking` (status.md or Supabase) — most builds never touch it, so it was
dead weight in the always-loaded core on every classic/rescue build. If mode is not `booking`,
skip this file entirely.
-->

## Booking facade (booking-mode leads only)

When this client's `extra.mode` is `booking` (status.md or Supabase), the site includes a **client-side booking facade** — a fully working booking flow with zero back-end. It demonstrates "your own booking system" on the preview; the real system arrives at conversion (see below). Five steps, one page or route (`/book` or a `#book` section, linked from nav + hero + sticky CTA):

1. **Service** — the real captured menu from gathered-content.md, exact names/prices/durations, grouped by category if the platform grouped them. Never invent, merge, or reprice services. **Price-free menus are valid**: when the business doesn't publish prices (or durations), list services without them — an unpublished price is silence, never a number you make up.
2. **Staff** (only if staff names were published) — otherwise skip this step entirely.
3. **Date & time** — a slot picker honouring the REAL opening hours: closed days disabled, slots only within published hours, sensible slot length from the service's duration.
4. **Details** — name / phone / email with validation.
5. **Confirmation** — a booking reference like `{3-LETTER-PREFIX}-XXXX` (derived from the business name, random digits), a "we'll confirm by text/email" line, and the service/time summary.

**Hard rules (each one is a QA fail):**
- **Zero network requests** in the whole flow — state lives in React memory only. No fetch, no form POST, no third-party widgets.
- **No "demo", "preview", "sample", or "not live" labels anywhere.** The site must read as the business's own finished site. The demo-mode conversation happens in outreach replies, never on the page.
- **Facade builds ship `noindex`**: set `robots: { index: false, follow: false }` in the layout metadata. A fake booking flow must not get indexed. (`/seo`'s Step 0 refuses to run while the facade is live, and removes the noindex once the real system or platform links are in.)
- **The facade never ships to a live client domain.** At conversion, BEFORE any custom domain is attached, either run `/booking {business-name}` (Vercel — replaces the facade with the real system: confirmations, dashboard, reminders) or, if the client prefers keeping their current platform, rewire every booking CTA to link out to it (their platform stays unless THEY choose otherwise) and write `clients/{business-name}/data/booking-rewired.md` (one line: date + CTA target) so `/seo`'s facade gate knows the demo is gone. **Non-Vercel installs** (`/booking` is Vercel-only): `golden_check` leads rewire to their platform; `no_website` leads convert the booking CTAs to the contact pattern from "Contact form" below — or move the site to Vercel first if the client wants real online booking.
- **Credential ceiling by silence** (booking verticals are often regulated-adjacent — aesthetics, massage, lash/brow): publish ONLY credentials the business itself published, verbatim. And never write compliance meta-commentary on the page ("qualifications not listed", "details available on request") — if they didn't publish it, the site is simply silent.
- **Home-based businesses get area-only treatment**: if gathered-content.md recorded area-only disclosure, the site shows town/area only — NO street address, NO postcode, NO map embed. The Google Maps CID rule elsewhere in this skill does not override this.
- **Per-platform review counts stay separate** — "212 reviews on Fresha" and Google's count are different facts; never conflate, never sum. Menu copy may have typos tidied (note each fix in status.md); reviews stay verbatim to the character as everywhere else.

**Fallback:** if gather couldn't capture a real service menu (rare — the platform page is public), do NOT fake one. Build the standard site with a "Book Online" button linking to their platform page instead, and note the downgrade in status.md — outreach must then drop the "its own booking page" line.

