# CLAUDE.md

## Project: Klaudius

You're running an autonomous SMB website agency. The pipeline finds local businesses (in whatever region the operator points it at) that don't have a website, builds them a bespoke one from publicly available data, deploys it, and sends outreach offering it for ${PRICING}.

## Configuration variables

Config lives in `.env`. Full reference (defaults, formats, fallbacks) is in `.env.example` — read it when you need the canonical definition of any placeholder. Edit `.env` directly or run `npx klaudius configure` to change anything.

Placeholders appear throughout this file and the skills as `${VAR}` — `.env.example` defines each one. Country/language fall back to `the United Kingdom` / `GB` / `English` / `en` if unset.

## User-facing docs

Two operator-facing references ship at the project root:

- **`DOCS.html`** — entry-point reading: install, getting the most out of Klaudius (Claude Code auto mode, model/thinking settings, throughput vs quality, the parallel pipeline mode, multi-account scaling), `npx klaudius doctor` / `configure` / `update`, where credentials live.
- **`operator-guide.html`** — deeper reference: follow-up and warm-leads data model and cadence, the deployment-host story (Vercel free vs Pro, Cloudflare Pages, Netlify), the Google Places trial-credit workaround, what to do when a client replies, macOS Full Disk Access for parallel SMS / iMessage.

When the user asks about anything covered there, answer briefly and point them at the relevant doc ("open `DOCS.html` in your browser").

## If asked to finish setup or debug install issues

Run `npx klaudius@latest install` first, read stderr carefully, and fix what you find. Verify with `npx klaudius@latest doctor` and report which checks are green vs red. Don't move on to pipeline work until install is clean.

## If asked to update Klaudius

When the user asks to update Klaudius / get the latest version:

1. Run `npx klaudius@latest update`.
2. If it reports conflicts, run `/resolve-conflicts` to walk through them.

Don't hand-merge template files or edit `.klaudius/manifest.json` directly — those two commands own that flow.

## Customising Klaudius (this section is for you, Claude)

Klaudius ships with sensible defaults. When the user asks in natural language to change tone, cadence, skip rules, pricing, channels, etc., you handle the edit — they shouldn't need to learn the file structure. Pick a sensible interpretation; don't ask 5 follow-up questions. Confirm what you changed in one line afterwards.

| Ask is about… | Edit | Notes |
|---|---|---|
| Outreach tone, voice, pitch wording, opening hook, CTA | `.claude/skills/outreach/SKILL.md` | Preserve structural rules (length cap, no em-dashes, sign-off variable) unless explicitly asked to change them. |
| Follow-up cadence (count, timing, channel rules) | `.claude/skills/follow-up/SKILL.md` and the "Outreach Sequence" table in this file | Keep both in sync. |
| Skip rules (filter candidates by reviews, age, industry, photos, etc.) | `.claude/skills/find/SKILL.md` for sourcing-time filters; the Critical Rules section of this file for pipeline-gating filters | Phrase as positive filters ("only pitch if X"). |
| Operating country / language | `.env` (`OPERATOR_COUNTRY`, `OPERATOR_COUNTRY_CODE`, `OPERATOR_LANGUAGE`, `OPERATOR_LANGUAGE_CODE`) | Single-country per install; if they want true multi-country, that's a second install. When changing a code, also change the matching full-name string. |
| Rescue mode on/off (also target businesses with bad existing websites) | `.env` (`PIPELINE_MODES`) | `classic,rescue` = both streams; `classic` = no-website only. Asked in the init/configure wizard; installs predating the wizard question enable it by adding the line here. Definition in `.env.example`. |
| Booking mode on/off (also target businesses whose "website" is a booking-platform page — Fresha, Booksy, Square...) | `.env` (`PIPELINE_MODES`) | Add `booking` to the list (e.g. `classic,rescue,booking`). Golden check + platform registry: `scripts/booking-check.js` + `scripts/booking-platforms.json`. Asked in the init/configure wizard; older installs enable it by editing the line here. |
| Pricing, currency, billing terms | `.env` (`PRICING`, `PRICING_TERMS`) | Both are free-form strings; bespoke wording is fine. |
| Invoice details (business name/address, tax label/rate/number, payment details, numbering prefix) | `.env` (`INVOICE_*`) | Captured once by the first `/send-invoice` run; edit here to change. Definitions in `.env.example`. |
| Outreach channel preference / WhatsApp accounts | `.env` (`OUTREACH_PRIORITY`, `OUTREACH_CHANNELS`, `WHATSAPP_ACCOUNTS`) | `OUTREACH_PRIORITY` is the source of truth. New WhatsApp number needs `npx klaudius pair-whatsapp --label <name>` first. |
| Pre-build checks (photos, reviews, contact requirements) | `.claude/skills/build/SKILL.md` "Pre-build checks" section | Don't weaken the photos check without strong reason — gradient-only sites are the #1 quality regression. |
| Design system rules (fonts, palette, line-count targets) | `.claude/skills/build/SKILL.md` "Anti-slop rules" + "Font" sections | Keep the broad anti-templatey principle even if specifics change. |
| QA standards / screenshot checks / deliverables | `.claude/agents/qa-reviewer.md` | If mandatory deliverables change, update the QA Loop in this file too. |

For `.env` changes the operator might also want `npx klaudius configure` (whole-wizard) — suggest it if they're changing several values at once.

After any customisation, append a one-line entry to `CUSTOMISATIONS.md` at the project root (create if missing): `2026-05-02 — Outreach tone changed to casual + cheeky (per user request)`. This is the audit trail.

## Commands

These are the things you can be asked to do. Lessons are split per stage under `prompts/lessons/` — each skill reads its own stage's file when it runs (don't read them all up front). When you learn something new, append it to the relevant stage file.

### "Run follow-ups"
Run `/follow-up`. Checks for client replies, updates pipeline statuses, and proposes due follow-ups for approval before sending.

### "Add a CMS" / "Make the site editable by the client"
Run `/cms {business-name}`. Retrofits a deployed client site with a password-protected `/admin` editor so the owner can edit their own text and photos. Vercel only; the skill has the full detail. **Run this when a client BUYS**, not as part of the spec build — see "Run the pipeline" for why.

Invoke it when a client converts (alongside `/seo`), for a site whose CMS install was skipped or failed, or when the operator asks for changes to an existing editor (§ Maintenance in the skill). It is deliberately NOT part of the spec-build pipeline.

### "Add a live Google rating" / "Show live reviews on the site"
Run `/auto-updating-google-rating {business-name}`. Retrofits a deployed client site so its Google star-rating and review count are fetched live from its Google listing and refresh as new reviews land. Vercel only; the skill has the full detail.

### "Add a booking system" / "Let customers book online"
Run `/booking {business-name}`. Retrofits a deployed client site with a bespoke booking system — restaurant/class slot bookings or salon-style appointments: online booking with email confirmations and calendar invites, self-service rescheduling, a staff dashboard, and day-of reminders. Starts with a short discovery conversation, then installs autonomously. Vercel only; the skill has the full detail.

### "Apply SEO" / "Get the client found on Google"
Run `/seo {business-name} [live-domain]`. One-shot go-live SEO + AEO/GEO optimisation for a deployed client site — canonical host, metadata and icons, entity-graph structured data, answer-shaped FAQ, `llms.txt`, live-retrieval crawler access, sitemap/robots, search-engine submission. `/build` already ships an AEO baseline on every site (see its § AEO baseline); `/seo` deepens it at go-live. Both are gated by `node scripts/aeo-check.mjs clients/<slug>/site`, which proves structure and extractability and explicitly cannot prove a citation. Run it when a lead converts, ideally after their domain is attached. Works on every host; the skill has the full detail.

### "Send an invoice" / "Invoice a client"
Run `/send-invoice {business-name} [amount]`. Generates a bespoke PDF invoice for the client and drops a ready-to-send draft email with it attached into the operator's own mailbox Drafts folder — the operator reviews and clicks send themselves; nothing is ever sent automatically. The first ever run asks for the operator's business details (invoice name, address, tax, payment details) once and stores them in `.env` for every later invoice. The skill has the full detail.

### "Run the pipeline"
Find and build new clients. For each new client, invoke the skills in order:
```
/find {region}            # Find a business without a website
/gather {business-name}   # Collect content from all public sources
/ui-ux-pro-max ...        # Generate the design system (palette, fonts, layout) BEFORE /build — see below
/build {business-name}    # Build bespoke Next.js site against that design system
QA loop (see below)       # Independent QA - agent reviews, you fix
/deploy {business-name}   # Deploy to your configured host (Vercel, Cloudflare Pages, Netlify, or your own server)
                          # NO /cms here — it runs on PURCHASE, not on spec. See below.
/outreach {business-name} # Send email or SMS outreach
```
Each skill has detailed instructions and rules. The skills are the source of truth, follow them precisely. Keep going continuously.

**`/cms` runs when the customer BUYS, not when the site is built.** Jeff, 2026-08-15. Every site we build on spec goes to a business that has not asked for it and mostly will not reply, so the editor is a cost we should only pay against revenue. Three specific costs, all measured rather than assumed:

- The retrofit flips the site off `output: 'export'` into a `force-dynamic` server app, so every pageview — including every bot crawl of a site nobody asked for — becomes a function invocation.
- Each retrofit creates a per-project Vercel Blob store on the account.
- **It is one-way.** Once `clients/<slug>/data/cms.md` exists, `/build`'s Step 0 retrofit guard refuses to rebuild that client, because a rebuild would delete the CMS wiring and orphan the owner's saved edits in Blob. On a prospect that is a real loss: a demo we might want to regenerate becomes frozen.

So the pipeline is `/find → /gather → /ui-ux-pro-max → /build → QA → /deploy → /outreach`, and `/cms` moves to the **conversion path** alongside `/seo`: run it when a lead converts, ideally after their domain is attached. Pitch the editor in outreach as what they get — it just does not get installed until they say yes.

> ✅ **The static-export `/` 404 this change re-exposed is FIXED (2026-08-15).**
> A prebuilt static-export deploy used to serve **404 at `/`** while `/index`, every subpage and
> every asset served 200 — `vercel build` re-homes `index.html` onto the serving path `index`
> (`overrides` in `.vercel/output/config.json`) and nothing then maps `/` onto it. The CMS
> retrofit was incidentally hiding it, because a server app serves `/` fine.
> The scaffold now ships `templates/trade-site/vercel.json` with one rewrite, `/` → `/index`.
> **Do not delete that file from a static site, and do not add it to a CMS site** (`/index` is
> not a route on a server app — the `/cms` skill deletes it deliberately). Proven by deploy:
> `/` 200, subpage 200, assets 200, unknown path still 404. Always verify a deploy with
> `curl -o /dev/null -w '%{http_code}' <alias>/` — `/index` returning 200 proves nothing.

Two conditions gate it, and neither one stops the pipeline:

- **Vercel only.** Check the host before invoking: `grep -E '^DEPLOY_PROVIDER=' .env | head -1 | cut -d= -f2- | tr -d '"'`. On `cloudflare`, `netlify` or `selfhost`, **skip `/cms` and carry on to outreach** — the editor needs server actions and Vercel Blob, which those hosts can't run. Write one line in `clients/<slug>/data/status.md` (`CMS skipped — DEPLOY_PROVIDER=<host>, editor needs Vercel`) so the gap is visible rather than silent, and don't pitch the editor in the outreach copy for that install.
- **A failed `/cms` never blocks the send.** The deployed site from `/deploy` is already live and pitchable. If the retrofit fails partway, follow the CMS skill's abort path (restore the pre-CMS page, alert via `scripts/notify.sh`), leave the client at `deployed`, note it in status.md, and continue to outreach with the plain site. A lead is worth more than an editor.

Consequence worth knowing before you invoke it: once `data/cms.md` exists, **`/build` refuses to rebuild that client** (its Step 0 retrofit guard), because a rebuild would delete the CMS wiring and orphan the owner's saved edits in Blob. From `/cms` onward the site is edited in place, per the CMS skill's § Maintenance.

**If `OUTBOUND_SENDER=ghl` in `.env`, do NOT run `/outreach` at all.** In that mode GoHighLevel owns the first touch: `/deploy` writes the deployed URL, the mirror tags the contact `demo-built`, and the published workflow "GR-598 Demo-First Send" sends T1 and T2 itself. Running `/outreach` as well would send the prospect a second first-touch email from a different address on the same day — the single worst thing this pipeline can do to a cold lead. `OUTBOUND_SENDER=mailbox` (the default) keeps the send on `gmail.py` and no trigger tag is ever applied. The two are mutually exclusive by design and `_may_enrol()` in `scripts/ghl.py` enforces it.

**If `OUTREACH_ENABLED=false` in `.env`,** stop after `/deploy` and do NOT run `/outreach` — the operator pitches manually. If the operator wants the message *prepared* for review (rather than skipped entirely), compose it per the outreach skill's wording rules and either save it to `clients/<slug>/data/outreach-draft.md` or create an email draft with `python3 scripts/gmail.py draft --to … --subject … --body …` (it lands in the operator's email Drafts folder — nothing is sent). Never actually send while `OUTREACH_ENABLED=false`.

**If `OUTREACH_PRIORITY` is exactly `email`,** /find screens candidates for a contactable email before claiming — see its "Email-only installs" section.

**Every pipeline step MUST be invoked via the Skill tool, not inlined as bash commands.** That means `Skill(skill="find", args="...")` and likewise for gather/build/deploy/outreach. Do NOT read a skill's body and then just run its bash commands yourself. Reasons: (a) the skill's frontmatter (notably `allowed-tools` restrictions) only fires when invoked via the Skill tool, so inlining defeats those guardrails; (b) the skill is the single source of truth, so if it's updated, future runs only benefit if you're invoking it rather than paraphrasing it. The one exception is `/ui-ux-pro-max`, which is invoked via the bundled mcp tool or shell script as documented above.

#### Design system step (`/ui-ux-pro-max`) is mandatory before `/build`
Every build must be preceded by a `/ui-ux-pro-max` invocation tailored to the business's industry. Skipping it produces template-looking sites — generic Tailwind palette, predictable font pairings, low line counts — which is exactly the failure mode that kills credibility with the business owner.

Run it like:
```
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "<industry> <style keywords>" --design-system -p "{Business Name}"
```
Use the returned palette, typography, and layout pattern as input to `/build`. The build skill enforces serif/sans contrast, banned/favoured font lists, and uniqueness against recent client sites — but the design *direction* (which palette family, which heading personality, which layout pattern fits this industry) comes from `/ui-ux-pro-max`. Don't invent it ad hoc inside `/build`.

#### QA Loop (replaces /qa)
After `/build` completes, QA is handled by an **independent agent** — the session that built the site subconsciously does lenient QA because it already knows the content and compromises, so a fresh agent with zero build context reviews the site as a business owner would: cold and critical. The agent that built the site must NOT review it.

**Round 1 is ALWAYS full — never scoped, no exceptions.** It is the only full look the site
ever gets, and it is not merely a formality: on a real build, round 1's fix was a one-character
JSX change on `/about`, and round 2's FULL re-review (not a scoped one) is what caught a
badly mismatched photo on the HOME page that round 1 had missed. A scoped round 2 that only
re-checked `/about` would have shipped it. That is why scoping only ever applies to round 2+,
gated on real evidence, never to round 1.

```
1. Spawn the qa-reviewer agent for ROUND 1 (always full). Use the dedicated subagent_type —
   NOT general-purpose — and give it the full deliverables contract in the prompt. A thin
   "follow the agent file" prompt has historically led agents to skip the screenshot and
   report-write steps:

   Agent(subagent_type="qa-reviewer", prompt="""Run a FULL QA check for client slug: {slug}.
   Follow .claude/agents/qa-reviewer.md exactly. This is round 1 — review every route.

   Mandatory deliverables — your run is invalid without all three:
   (a) Run `npx next build`, serve `out/`, take all 3 desktop screenshots (qa-top, qa-mid,
       qa-bottom) AND all 3 mobile screenshots (qa-mobile-top, qa-mobile-mid, qa-mobile-bottom)
       for EVERY route AND visually review each one with the Read tool. Source-code grep is
       not a substitute for visual review of the rendered site.
   (b) Write the full report to clients/{slug}/data/qa-report.md. The file must exist on
       disk when you finish — not just included in your final message.
   (c) Delete the screenshot PNGs after review (Step 6 cleanup).

   (d) Run the ship scan and report its verdict: `node scripts/ship-scan.mjs clients/{slug}/site --fix`.
       It strips developer comments from the shipped html/css and blocks on leaked secrets,
       operator filesystem paths, source maps, .env artefacts, and machine-generated tells
       (lorem ipsum, TODO:, [insert ... here], PLACEHOLDER). A ship-scan FAIL is an automatic QA
       FAIL however good the site looks — none of it is visible in a screenshot, which is why it
       is scripted. See § MANDATORY: ship scan in .claude/agents/qa-reviewer.md.

   (e) Tag every critical issue you report as LOCAL (confined to the specific route/file you
       found it in, would not appear elsewhere) or SYSTEMIC (a shared component, globals.css,
       layout.tsx, config, or a pattern likely repeated across routes). This tag is read by the
       orchestrator, not decorative — be honest, default to SYSTEMIC when unsure.

   In your final message back to me, explicitly confirm:
     • the ship-scan verdict, with every FAIL line verbatim and what --fix changed
     • the absolute path of the qa-report.md you wrote
     • that you took and visually reviewed all screenshots for every route (desktop + mobile)
     • that the screenshot PNGs were deleted

   If you could not complete any of (a)/(b)/(c), say so honestly and mark your verdict
   as FAIL. Do not silently skip steps and report PASS.""")

2. After the agent returns, verify its claims before trusting the verdict:
   - `ls clients/{slug}/data/qa-report.md` must succeed
   - If it doesn't, treat the run as invalid and re-spawn the agent — do not deploy
     on the strength of a verbal-only verdict

3. Read the verdict:
   - If PASS: continue to /deploy
   - If FAIL: go to the qa-fix + round-2+ procedure below.
   - **Any TRUE in the report's "Hard-blocker contract" section is itself a FAIL, full stop —
     never deploy on a report where all 5 are FALSE is missing or any is TRUE**, even if the
     Verdict line says PASS. That line existing separately from the 5 booleans is exactly the
     failure mode this mechanism replaced: an impression question with nothing computed from it.
     Treat a missing/incomplete hard-blocker section the same as an invalid report (step 2).

4. Maximum 3 QA iterations. If still failing after 3 rounds, stop and
   ask the user for guidance.
```

##### Round 2+: scoped, double-keyed against a real footprint (never against self-report)

**Why this exists.** Every deterministic gate re-running plus a full 6-screenshot review on
every single round is real, measured cost — one build's own transcript showed 31 total
deterministic-gate invocations across 3 rounds. Most of that is legitimate (round 1 must be
full), but round 2+ re-reviewing routes qa-fix never touched is pure waste **once there is a
real, independent way to know it's safe** — which there now is: `verify-photos.mjs` closes the
exact defect class (a wrong/uncleared photo) that used to make a full re-review the only safety
net, and it runs as part of the deterministic battery on every round regardless of scope.

**The double key — BOTH must say "local", or force full re-review:**

1. **Key 1, the reviewer's own tag** (from step 1(e) above, or the equivalent scoped-round tag
   below): no SYSTEMIC-tagged critical in this round's report.
2. **Key 2, the orchestrator's own measurement — never the fixer's self-report.** Before running
   `/qa-fix`, snapshot the client's source tree: `find clients/{slug}/site/src clients/{slug}/site/public -type f | sort | xargs shasum -a 256 > /tmp/{slug}-pre-fix.sha256`. After `/qa-fix`
   completes, snapshot again the same way and diff the two files. The diff is the REAL footprint
   — a fixer that touched `globals.css` while "just fixing a typo" is exactly the case that must
   escalate, and only a real file-content diff catches that; an agent's own claim of what it
   touched is not evidence.

**Escalation triggers — any ONE of these forces a FULL, unscoped round (same as round 1), no
exceptions:**
   - the diff touches `globals.css`, `layout.tsx`, `tailwind.config.ts`, `next.config.mjs`,
     `site-data.ts`, or `blog-data.ts` — these are imported by every route (or, for blog-data.ts,
     every blog route) by construction, so there is no narrower real footprint to compute
   - the diff touches any OTHER file under `_components/` **whose real import graph is more than
     one route** (measured, 2026-08-19 Fable review — see below), OR the import graph could not be
     computed
   - the diff touches any `public/` file referenced from more than one route
   - any deterministic gate (font/font-uniqueness/contrast/token/photo/ship-scan/richness/HyperUI-usage/HyperUI-transplant/copy-fingerprint) FAILed
   - the reviewer tagged any critical SYSTEMIC
   - the real diff touches a route the reviewer's scoped review did NOT cover

**Import-graph-scoped escalation for `_components/` files (2026-08-19 Fable review).** The old rule
treated every `_components/` touch as automatically systemic — but a component like `HeroVideo.tsx`
renders on exactly one route (`/`), and a real build's round 2 paid for an 11-route full re-review
(measured: ~11+ minutes of screenshot capture alone) to fix a one-route autoplay bug in it. Before
treating a `_components/` diff as an automatic full-round trigger, compute its REAL import set —
same "orchestrator's own measurement, never self-report" discipline as the shasum diff itself.
**Must be TRANSITIVE, not one hop** (code-review finding, 2026-08-19): a component imported by only
one OTHER component still reads as "1 importer" on a single grep pass even when that importer sits
in `layout.tsx` and renders on every route — expand every `_components/` hit again until the
frontier is only route files:
```bash
frontier="$(for f in $TOUCHED_COMPONENT_FILES; do basename "$f" | sed 's/\.[^.]*$//'; done)"
routes=""
for _ in 1 2 3 4 5; do  # bounded iterations, not a real fixed-point loop -- 5 hops covers any
                         # realistic component nesting depth in this template; if it's still
                         # finding new _components/ hits after 5, treat as unresolved (below)
  next_files=""
  for name in $frontier; do
    hits=$(grep -rlF "$name" clients/{slug}/site/src/app --include='*.tsx' | grep -v "_components/${name}\.")
    next_files="$next_files $hits"
  done
  new_components=$(echo "$next_files" | tr ' ' '\n' | grep '_components/' | xargs -n1 basename 2>/dev/null | sed 's/\.[^.]*$//' | sort -u)
  new_routes=$(echo "$next_files" | tr ' ' '\n' | grep -v '_components/' | sort -u)
  routes="$routes $new_routes"
  [ -z "$new_components" ] && break
  frontier="$new_components"
done
echo "$routes" | tr ' ' '\n' | sort -u
```
`grep -rlF` (fixed-string, not `\b...\b`) sidesteps any component-name/regex-metachar mismatch, and
matches on the plain basename without the extension, so a `.ts` file (`schema.ts`, `site-data.ts`)
doesn't leave a stray `.` that could act as a wildcard.

If every touched `_components/` file's REAL (transitively-resolved) import set is exactly the
routes already in `TOUCHED_ROUTES` (or a subset), it is NOT an escalation trigger — add its
importing routes to the scoped review set instead of forcing a full round. If the grep fails, times
out, hits the 5-hop bound still finding new components, or returns nothing (can't confirm zero
importers is suspicious, not reassuring), fall back to the original full-escalation behaviour
— an unprovable import graph is exactly the "could not be computed" case above.

**If no trigger fires, scope round 2+:**

```
PRE: snapshot source tree (shasum) before /qa-fix runs.
Run /qa-fix {business-name} to fix round N's reported issues.
POST: snapshot source tree (shasum) again, diff against PRE -> TOUCHED_FILES.

Map TOUCHED_FILES to routes: a changed clients/{slug}/site/src/app/{route}/page.tsx
touches exactly that route. A changed shared config file (globals.css, layout.tsx,
tailwind.config.ts, next.config.mjs, site-data.ts, blog-data.ts) is an unconditional escalation
trigger (above) — stop here and run a full round instead. A changed file under _components/ is
NOT automatically an escalation trigger — compute its real import graph per the
"Import-graph-scoped escalation" section above first; only escalate if that graph exceeds the
already-touched routes or can't be confirmed.

If no trigger fired:
  CANARY = one route NOT in the touched set, chosen deterministically so it rotates rather
  than always landing on the same page: sort all routes alphabetically, exclude the touched
  ones, pick index = (round_number - 1) mod (remaining count).

  Agent(subagent_type="qa-reviewer", prompt="""Run a SCOPED QA check for client slug: {slug}.
  Follow .claude/agents/qa-reviewer.md exactly, with this scope override:

  This is round {N}, scoped. qa-fix's real diff touched only: {TOUCHED_ROUTES}.
  - Run the FULL deterministic battery exactly as normal (font/font-uniqueness/contrast/token/
    photo/ship-scan/richness/HyperUI-usage/HyperUI-transplant/copy-fingerprint) — these are scripts, ~2-3 minutes, and they cover every page
    regardless of scope. Do not skip or narrow them.
  - Screenshot and visually review ONLY: {TOUCHED_ROUTES} plus this rotating canary route:
    {CANARY_ROUTE}. Do not screenshot the rest of the site this round.
  - Tag every critical LOCAL or SYSTEMIC (see round-1 instructions for what each means).
    If you find anything that makes you suspect an untouched route could also be affected,
    say so explicitly and tag it SYSTEMIC — do not stay silent because it's out of nominal
    scope.
  """)

  Read the report. Apply the double key:
    - reviewer tagged everything LOCAL, AND
    - the orchestrator's own shasum diff didn't touch anything on the escalation list
      and didn't touch a route outside {TOUCHED_ROUTES}
  Both true -> scoped result stands (PASS -> deploy, FAIL -> another qa-fix round at the
  same scope discipline). Either key says otherwise -> discard the scoped result and run
  a full, unscoped round instead before deploying. Never split the difference.
```

**Never scope round 1. Never trust a scoped PASS against only one key.** When in doubt, run
full — the full round costs ~10-12 extra minutes; a defect that reaches a real business owner
costs the lead.

**Quality over quantity.** 2 excellent sites with real photos, accurate content and polished design are worth more than 5 mediocre gradient-only sites. Every site gets sent to a real business owner. If it looks like a low-effort template, it damages the brand and wastes the lead. Never cut corners on gather (photos, reviews) or build (design quality) to increase throughput. The pipeline exists to produce sites good enough that a business owner thinks "someone actually built this for me", not "an AI spat this out".

### "Run pipeline in parallel" / "Run pipeline x3" / "Parallel run"

Same goal as "Run the pipeline" but in parallel: you act as the **orchestrator**, dispatching N concurrent `claude --bg` pipeline children and keeping the pool full — you never run skills yourself. If the user says "x3"/"x4"/"run 5", use that pool size; otherwise ask. The full mechanics (dispatch, completion handling, worktree sync-back, failure tiers, status/stop/scale) live in **`prompts/parallel-run.md`** — read that file and follow it before dispatching anything.

### "Run everything"
Run follow-ups first, then the pipeline. Keep looping.

## Critical Rules

0. **Only work on clients you create in this session.** Do NOT pick up incomplete clients from other sessions. If the user wants you to finish a specific client, they'll tell you explicitly.
1. **Never open the user's browser unprompted** - NEVER run `open` or `open mailto:`. All emails via `python3 scripts/gmail.py send`. Background browser work via `npx playwright-cli` (headless).
2. **Never hallucinate content** - Only use content gathered from real public sources.
3. **Operator-defined target region.** Klaudius is region-agnostic at the framework level. You operate in whichever country/region the operator targets — `${OPERATOR_COUNTRY}` from `.env` is the default (falls back to "the United Kingdom" if unset). The operator can override per run by passing a specific city/region when they invoke `/find`. Picking the session's town within that region is the find skill's job — it rolls at random over unworked candidates, deliberately; don't override the roll with a judgment pick. Don't default to the same regions every session, parallel-session collisions are the biggest time sink.
4. **Operator-defined language.** Every outreach message, every follow-up, and every built website is written in `${OPERATOR_LANGUAGE}` (falls back to English if unset). Write idiomatic, natural `${OPERATOR_LANGUAGE}` — not literal English-to-X translation. Use the conventions a native speaker would use for business correspondence (e.g. formal "voi" form in Italian B2B; usted in Spanish B2B; vous in French B2B). Site `<html lang>` attribute matches `${OPERATOR_LANGUAGE_CODE}`. Content gathered from public sources (Google reviews, Instagram bios, Facebook pages) is ALREADY in the local language — pass it through verbatim into the site, do not translate it into English at any stage. Skill files stay in English; the language placeholder applies to outputs (messages sent, sites built), not to framework files or your reasoning.
5. **Target: NO website** - Business must NOT already have a website. Exceptions: when `PIPELINE_MODES` in `.env` includes `rescue`, businesses whose existing site is verifiably dead or bad also qualify (find skill's Rescue mode section); when it includes `booking`, businesses whose only web presence is a booking-platform page also qualify (find skill's Booking mode section, gated by `scripts/booking-check.js`).
6. **Outreach channels** - `/outreach` walks `OUTREACH_PRIORITY` (e.g. `email,whatsapp,sms`) per-client, picking the first channel that's viable AND succeeds. Adapters:
   - Email: `python3 scripts/gmail.py send`
   - WhatsApp: `node scripts/whatsapp.mjs send` (auto-routes across the linked accounts in `WHATSAPP_ACCOUNTS` via round-robin; the picked account is returned in the JSON response and must be stamped onto `outreach_account` for follow-up routing)
   - SMS: `python3 scripts/imessage.py send` or `python3 scripts/twilio_sms.py send` (per `SMS_PROVIDER`)
   
   If a channel's send fails per-recipient (e.g. WhatsApp returns `not_on_whatsapp`), silently cascade to the next channel in the priority list. If it fails account-level (auth expired, account banned), alert via `bash scripts/notify.sh "<reason>"` and STILL cascade to the next channel so this client isn't blocked. If all priority channels are non-viable or fail, and the business has Facebook/Instagram, mark as manual DM per the outreach skill's "Channel: Manual DM" section — the operator sends the DM themselves from their own account; never send DMs yourself. Otherwise leave the client at `deployed` (don't mark `unreachable` unless we've genuinely exhausted every avenue). A business needs at least one of: email, mobile phone (for SMS or WhatsApp), Facebook, or Instagram to proceed — usable by an enabled channel or the manual-DM lane (/build's reachability check enforces this).
7. **No duplicate clients** - Before adding any client, check ALL available contact fields against the database via the Supabase MCP: `SELECT slug, name, phone, email, landline FROM clients WHERE phone = '<digits>' OR email = 'foo@bar.com' OR landline = '<digits>'`. Check every field you have. Phone numbers are auto-normalised in the DB (spaces/dashes/parens stripped, leading + preserved); query with just the digits or with the leading +.
8. **If other Claude Code sessions are running in parallel**, check Supabase for existing clients before starting to avoid duplicates. Skip any client with status `claimed`, another session is working on it.
9. **Claim before working.** When you start working on a client (find, gather, build, etc.), immediately claim them in Supabase: `python3 -c "from scripts.db import claim_client; print(claim_client('SLUG'))"`. This is atomic. If another session races you, only one succeeds. Update to the real status when done: `python3 -c "from scripts.db import update_status; update_status('SLUG', 'gathered')"`.

10. **Delegate to a sub-agent only in the two cases below.** Do NOT use the Agent tool for find, gather, deploy, or outreach, or for any part of `/build` that touches the design surface. Always invoke those skills yourself directly. You are a worker, not an orchestrator.

    **Exception 1 — QA.** After `/build`, spawn the `qa-reviewer` agent (see QA Loop above) so the site gets reviewed by fresh eyes with no build context.

    **Exception 2 — non-design PROSE surfaces only (blog added 2026-08-16; widened 2026-08-19,
    both on Jeff's approval).** Once the five blog article topics are fixed and
    `gathered-content.md` is written, you may spawn **one** sub-agent to draft, concurrently with
    your own page writing: (a) the five blog articles into `blog-data.ts`, (b) the privacy/terms page
    prose (they render through one frozen, non-bespoke template — no layout or component decision
    to make), and (c) — where § Per-service pages fires — the per-service body prose. **For BOTH (b)
    and (c), the sub-agent returns plain text only — never touches a `.tsx` file directly.** You
    place the returned prose into `privacy/page.tsx` / `terms/page.tsx` / the relevant service
    `page.tsx` yourself. (Only clarified 2026-08-19 — (b)'s original wording didn't repeat this
    text-only qualifier that (c) stated explicitly, which read as though the sub-agent could write
    the privacy/terms `.tsx` files itself; it cannot, same as (c).)

    *Why this is allowed when the rest is not.* Measured on a 14-route build: 47.8 of 55.8 minutes
    was token generation, and roughly 4,000 words of it is blog prose that touches **no design
    surface at all** — no palette, no layout, no motion, no components. Rule 10 exists so the site
    has one accountable author whose design decisions stay coherent across pages; none of (a)/(b)/(c)
    can cause design drift by the same reasoning that already cleared blog prose, so widening to
    these three surfaces is not a new exception, it's the same one applied to its full scope. It
    remains a genuine concurrency win because the sub-agent's generation is a separate concurrent
    call, and it moves more of the ~93-minute generation-phase floor onto a lane already proven safe.

    *The bounds, and they are not optional:*
    - **One** sub-agent for all of (a)/(b)/(c) combined, not one per surface or one per article.
    - **You** choose the blog topics and, for (c), the specific facts/claims each service page will
      make — the sub-agent drafts prose against your decisions, it does not make them.
    - Attach `gathered-content.md` and carry the **three-bucket truth rule** into its prompt
      verbatim. An invented claim about a real business is the worst output this pipeline can
      produce, and a sub-agent has less context to notice it, not more.
    - **You review everything that comes back against `anti-ai-slop`'s eval before committing it**
      anywhere. Delegating the writing does not delegate the judgement.
    - Never delegate `page.tsx` itself, `globals.css`, the shared chrome, or anything under
      § Visual richness. (c)'s prose comes back as text, not markup — you write every `.tsx` file
      that exists. If you catch yourself reaching for a second sub-agent, or letting this one touch
      a component/layout/style decision, stop — that is the line.
11. **NEVER skip QA.** Every site MUST go through the QA loop (qa-reviewer agent) before deploying — no exceptions, however rushed the run or simple the site. Deploying a broken site to a real business owner wastes the lead.
12. **NEVER send test/debug messages to real clients.** No test emails, test SMS, test anything to client email addresses or phone numbers. Ever. If you need to test SMTP/IMAP, send to your own `${EMAIL_ADDRESS}` (it loops back to your inbox). For SMS tests, send to `${TEST_PHONE}` (your personal mobile). A client receiving "test" from you is unprofessional and wastes the lead.

## Alerting

You cannot reliably tell whether a human is watching this session. Assume they are not. If anything happens that warrants a human eye — an external API failing, content that looks wrong, a build/deploy that didn't succeed, behaviour you can't explain, gathered data that looks suspiciously sparse, a tool returning something unexpected, anything you'd want to flag — send an alert via `bash scripts/notify.sh "<message>"` at the moment you notice it. Don't wait until your final response to surface it. (The script routes to Telegram, email, or SMS per `NOTIFY_CHANNEL` in `.env`; if the chosen channel isn't configured, it no-ops silently and that's fine.)

**Alert on TERMINAL events only — build complete, or build failed. Not on stage progress.**
Changed 2026-08-16 on Jeff's call after every build produced roughly three notifications per app.

The arithmetic: `NOTIFY_CHANNEL=telegram,slack` fans every call out to BOTH channels, so one
`notify.sh` call is two messages. Combined with call sites in `/find`, `/build` and `/deploy`, a
single build fired three logical alerts and landed six messages. The old instruction here said
"bias toward over-alerting", and it was doing exactly what it said.

**Why this is a real fix and not just quieting things down:** mid-pipeline noise trains the operator
to swipe alerts away without reading them, and the one that finally matters gets swiped with the
rest. That is the same failure as a gate that is always red. An alert nobody reads protects nothing.

So:
- **DO alert** when a build finishes (with the live URL) and when it fails in a way that stops the
  pipeline or needs a human — auth expiry, a wedged external API, a dead deploy, gathered data that
  looks fabricated.
- **DO NOT alert** on stage transitions, "starting /gather", per-step progress, or anything the
  operator would learn anyway from the completion message.
- Still include the client slug and a one-line description on every alert you do send.
- If something genuinely warrants a human eye mid-run, that IS terminal for alerting purposes — send
  it. The rule removes routine progress chatter, not judgement.

Alerting is **not** the same as halting. Alert generously; only halt the run if continuing would do harm (e.g. send broken outreach to a real lead, mark a viable lead as unreachable). Otherwise, alert and keep going.

## Client Folder Structure

```
clients/{business-name}/
├── data/
│   ├── gathered-content.md   # All gathered content, organised by source
│   └── status.md             # Pipeline progress tracking
├── site/                     # Next.js website (bespoke per client)
└── screenshots/
```

Outreach threading metadata (Message-ID, subject, sending account) is stored in Supabase, not in files. The actual message content lives in the email inbox / SMS conversation.

## Browser Automation

```bash
npx playwright-cli open                              # Open session
npx playwright-cli goto <url>                         # Navigate
npx playwright-cli eval "document.body.innerText"     # Extract text
npx playwright-cli snapshot                           # DOM snapshot
npx playwright-cli screenshot --filename=output.png   # Screenshot
npx playwright-cli -s=myname open                     # Named session (avoid conflicts)
npx playwright-cli close                              # ALWAYS close when done — sessions never self-close
```

### Known issues with headless browsing
- **Google consent wall**: First visit requires accepting cookies. Use: `eval "document.querySelectorAll('button').forEach(b => { if(b.textContent.includes('Accept')) b.click() })"`
- **Snapshot ref staleness**: `click ref=XXX` can fail if the page has changed since the snapshot. Using `eval` with `document.querySelector().click()` is more reliable.
- **Search engine CAPTCHAs (2026)**: Yahoo, Brave, Google, Bing all serve anti-bot challenges to headless browsers (even Patchright). The exception is the DuckDuckGo HTML lite endpoint (`html.duckduckgo.com/html/`) — a no-JS SERP for non-browser clients, plain curl works. `scripts/ddg-search.js` wraps it. It rate-limits rapid successive queries (HTTP 202 "please retry"), so keep search calls minimal per gather. `scripts/yahoo-search.js` is a last-resort fallback (Yahoo's anti-bot usually fires anyway).
- **Cloudflare**: Yell, Checkatrade, Bark, FreeIndex, TripAdvisor, Yelp all block stock Playwright. Options: use Patchright (undetected Playwright fork) or rebrowser-patches, or use a bypass service (Scrapfly, ScrapingBee).
- **Instagram**: don't improvise the well-known `i.instagram.com/api/v1/users/web_profile_info` curl — it schema-fails server-side for most SMB business accounts. `scripts/instagram-profile.js` wraps what still works; a missing email there means unknown, not "no email".
- **Google Maps navigation**: Always navigate via search results, not direct place URLs. Search-based navigation gets fuller data and is less likely to trigger limited view.

## Outreach Style

- No em dashes or en dashes
- Use contractions
- Short - the initial message is around 55 to 80 words (shorter reads more human); never over 150
- Sound human, not AI
- Reference specific details
- Include preview URL
- Price: `${PRICING}` ${PRICING_TERMS}
- Sign off: `${SIGNATURE}` if set, otherwise compose using `${OPERATOR_NAME}` + `${OPERATOR_LANGUAGE}` conventions (see outreach SKILL Language section)
- Pitch: "I built you a website. Have a look." Lead with the finished build (the gift); identity is carried by `${SIGNATURE}`. NEVER open with "I came across you on Google Maps" or "I noticed you don't have a website" - that deficit opener is the saturated spam-signature every AI web-dev pitch uses, and owners bin it on sight.

## Outreach Sequence (5 touches, 21 days)

| Touch | Day | Channel | Angle |
|-------|-----|---------|-------|
| 1 | 0 | Whichever channel the priority cascade selected for this client (email / WhatsApp / SMS / manual DM) | Initial pitch: lead with the finished site (gift, not "you don't have a website"); soft price |
| 2 | 3 | Same as Day 0 | Soft nudge: "just making sure this reached you" |
| 3 | 7 | Same as Day 0 | Decision moment: when people search "{industry} in {location}", the ones with websites get the click |
| 4 | 14 | Same as Day 0 | Verification: even people who find you on Maps check for a website before calling |
| 5 | 21 | Same as Day 0 | Breakup: "last message, site is still live if you change your mind" |

The "Touch" column is `outgoing_touch_count` after that message is sent — `/follow-up` selects the next touch off the current count (count 1 → send touch 2).

**Same-channel rule**: Always follow up via the same channel as the initial outreach. Never cross channels for follow-ups, because thread state lives on whichever side actually sent (the WhatsApp daemon's SQLite, IMAP for email, chat.db or Twilio's message log for SMS).
Use `python3 scripts/imessage.py send` (or `python3 scripts/twilio_sms.py send`) for SMS, `node scripts/whatsapp.mjs send --account <stored-account>` for WhatsApp (the account from `outreach_account` is mandatory), `python3 scripts/gmail.py reply` for email (to keep in same thread).
NEVER send outreach twice to same client on same day. NEVER follow up if client has responded.

## Tracking

Central tracker (the operator's CRM): **Supabase** (PostgreSQL). Use `scripts/db.py` for all pipeline state operations.
Per-client outreach metadata (Message-ID, subject, account, follow-ups) is stored in Supabase.
Pipeline statuses: `found` → `claimed` → `gathered` → `built` → `deployed` → `outreach_sent` → `responded` → `converted` / `rejected` / `lapsed` / `unreachable`

**Answering pipeline-state questions.** When the operator asks about clients, statuses, counts, or outreach history, query Supabase and answer from the result — not from session memory or `clients/<slug>/data/status.md` (a per-client checkpoint file that drifts from the DB). Thread-state cache columns are only as fresh as the last sync — check `thread_synced_at`. If the database is unreachable, say so, and flag anything you state that you didn't just verify.

### Database operations

**Reads: prefer the Supabase MCP (`mcp__supabase__execute_sql`).** Run raw SQL against `clients` for lookups, candidate pools, duplicate checks, status counts. Phone numbers are auto-normalised in the DB (digits with optional leading +), so query with the digits.

**Writes: use `scripts/db.py` helpers** (`claim_client`, `claim_outreach`, `update_status`, `update_deployed_url`, `set_outreach_sent`, `release_outreach_claim`, `classify_inbound`, `set_response`, `set_lapsed`, `add_client`). They encapsulate status transitions, timestamping, and phone normalisation. The claim helpers are the only safe path for atomic claims, never reimplement those in SQL. Each skill inlines the specific helper call it needs; the full surface is in `scripts/db.py`.

**Thread-state cache.** `last_out_date`, `last_in_date`, `outgoing_touch_count`, `has_inbound_since_last_out`, `last_in_preview` are written by `scripts/sync_thread_state.py`. `/follow-up` and `/warm-leads` refresh it at the start of each run, so within a skill invocation the cache is fresh. Don't write to these columns directly.

CLI status checks (handy at the prompt; MCP SQL is usually tighter):
```bash
python3 scripts/db.py status        # count by status
python3 scripts/db.py incomplete    # list incomplete clients
python3 scripts/db.py client SLUG   # view single client
```

### Client schema (Supabase columns)
Required: `slug` (unique), `name`, `status`
Common: `location`, `industry`, `owner`, `phone`, `email`, `landline`, `facebook`, `instagram`, `deployed_url`, `notes`
Outreach send-side: `outreach_channel`, `outreach_first_sent`, `outreach_message_id`, `outreach_subject`, `outreach_account`
Thread-state cache (written by `sync_thread_state.py` only — see above): `last_out_date`, `last_in_date`, `outgoing_touch_count`, `has_inbound_since_last_out`, `last_in_preview`, `thread_synced_at`
Inbound classification (set by `/follow-up` Stage A): `last_in_classification` (`noise` / `genuine` / `rejection` / `unclear`), `last_in_classified_for_date`
Routing cache: `imessage_capable` (BOOLEAN, nullable)

For WhatsApp, `outreach_account` stores the label of the WhatsApp account that sent (e.g. `primary`, `secondary`) — follow-ups MUST use that same account by passing `--account <value>` to `node scripts/whatsapp.mjs`.

## Pricing
- **${PRICING} ${PRICING_TERMS}**
- Includes: site build, hosting, deployment, domain setup help, a blog with five articles written for the business's own customers on every build (`/build` § Blog), and the owner's own `/admin` editor (Vercel installs — `/cms` is installed on PURCHASE, not on the spec build; see "Run the pipeline")
