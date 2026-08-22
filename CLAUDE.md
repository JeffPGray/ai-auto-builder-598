# Klaudius — evaluation track

Parallel evaluation of a purchased third-party build engine. **This repo does not modify
`gr-no-website-builds`.** That engine stays the production lane until this one is proven better.

**Rule 0 (inherited): running code is the only truth.** Everything below was verified on
2026-08-15 by reading the shipped npm binary, the vendor's install script, and their live
published output. Claims that could not be verified are marked `UNVERIFIED` and say why.
Nothing here is copied from Klaudius marketing.

---

## What this is

Klaudius (klaudius.dev) — a $399 one-time licence for a self-hosted Claude Code agency pipeline:
lead finder → content gather → site build → deploy → outreach → follow-up.

**Why it was bought — the cost model, not the design.** `gr-no-website-builds` burns ~$5/build in
Anthropic API credit: on 2026-08-15 that was $36 across three builds ($4.86, $6.13, $4.89) for one
usable site. Klaudius runs generation inside Claude Code on a Pro/Max subscription, so marginal cost
per site is ~$0. That is the whole thesis.

Output quality is a real second problem — Jeff rates the current sites 4/10 — but **Klaudius was not
bought because its design is known to be better. That is unmeasured, and it is TEST 2.**

**This is a 7-day refundable evaluation, not a decision to switch engines.**
Purchased 2026-08-15 · **refund deadline 2026-08-22** · a refund automatically revokes the licence.

Vendor: Cloudbot Limited, hello@klaudius.dev. Licence: `UNLICENSED` on npm — commercial client work
permitted, reselling or redistributing the source forbidden.

---

## Verified facts

### The $0-marginal-cost premise HOLDS

The wizard collects **no `ANTHROPIC_API_KEY`**. Every credential it writes is:
Supabase, Vercel/Netlify/Cloudflare, Google Places, an email provider, Twilio/iMessage, Telegram.

> Verified by extracting every env var name from `dist/*.js` in `klaudius@0.24.1`. There is no
> Anthropic key, and no other LLM-provider key, anywhere in the CLI.

Generation runs inside Claude Code on the operator's own Pro/Max subscription. The README states a
Claude Code subscription is a prerequisite. **This is the strongest single fact supporting the
purchase** and it is confirmed from the binary, not from marketing copy.

### Distribution and the licence gate

- npm package `klaudius@0.24.1` ships **only the CLI** — `dist/bin.js` + two chunks, 224KB total.
- The actual product (Claude Code skills, Python scripts, Next.js template, Supabase schema) is
  fetched from `https://klaudius.dev/api/template` **after** `POST /api/licenses/validate`.
- Consequence: **builder internals cannot be read without the licence key.** `npm pack` gives
  nothing. Their README says so explicitly and it checks out.

### Install state on this machine

`setup.sh` was reviewed line-by-line and run on 2026-08-15. It is clean: no sudo, checksum-verified
Node from nodejs.org, `uv`-managed CPython, everything into `~/.local`.

- Node 24.12.0 — already present, untouched.
- **Python 3.9.6 failed the ≥3.10 requirement.** Python 3.12.13 was installed into `~/.local`.
- `~/.local/bin` was already on PATH, so **`.zshrc` was not modified**.
- ⚠️ **Side effect to know about:** `~/.local/bin/python3` now symlinks to uv's CPython 3.12 and
  shadows the system `/usr/bin/python3` (3.9.6) for anything resolving via PATH. This is a global
  change affecting other Python work on this machine, notably `gr-marketing-ops`. It is an upgrade,
  not a break, but it was not previously true.
- `npx klaudius preflight` passes all five checks.

### The init gate is the vendor's own design

`preflight` ends by printing, verbatim:

> `AI assistant: stop here. Do not run init yourself — tell the user to run it in a new terminal.`

`npx klaudius@latest init my-agency` is an interactive wizard that prompts for the licence key and
provider passwords. **This is a credential operation — Jeff runs it, never the agent.** It is also
consistent with the vendor's documented position that Klaudius has no headless/CI/cron support.

### Output shape — the sample sites are SINGLE-PAGE

The vendor publishes three sample sites as representative output: `/sample-heating`,
`/sample-electrical`, `/sample-mechanic`.

`/sample-heating` navigation is entirely **anchor links on one URL**:

```
#top  #services  #work  #about  #area  #reviews  #contact
```

Every one resolves to a section `id` on the same page. There are **no internal links to subpages** —
the only `/sample-heating/*` hrefs are ten image assets. Their `sitemap.xml` lists each sample as a
**single URL**.

The only JSON-LD on the sample page is **Klaudius's own `Organization` schema**, injected by the
marketing site's root layout. **The sample business has no `LocalBusiness` schema of its own.**

> ⚠️ `UNVERIFIED` as a statement about the licensed template. These are marketing samples rendered
> inside the vendor's Next.js marketing app, which may strip or restructure things. It is strong,
> directionally consistent evidence — Jeff's own research found no multi-page claim anywhere in
> their marketing — but **TEST-01 must still be run against a real licensed build** before this is
> treated as settled. Do not write "Klaudius is single-page" into a decision doc off this alone.

### Configuration surface relevant to GR-185

Read out of the wizard's env-writing code:

| Env var | Why it matters here |
|---|---|
| `PRICING`, `PRICING_TERMS`, `PRICING_MONTHLY` | Pricing is parameterised — $598 + $98/mo is config, not a fork. |
| `DEPLOY_PROVIDER`, `VERCEL_TOKEN`, `VERCEL_SCOPE` | Native Vercel deploy. `VERCEL_SCOPE` takes `team_i8ra4hL0aEUCXmNX82Pey5WE`. |
| `SELFHOST_DEPLOY_TARGET`, `SELFHOST_URL_TEMPLATE` | A URL-template seam that may make `{slug}.grayreserve.agency` config rather than a port. **`UNVERIFIED` — the template's deploy skill is behind the licence gate.** |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_PAT` | Pipeline state is **Supabase Postgres**, not a local SQLite `db.py`. |
| `GOOGLE_PLACES_API_KEY` | Lead sourcing is Google Places. |
| `EMAIL_*` (Gmail/Outlook/IONOS/Fastmail/Zoho/Titan), `SMS_PROVIDER` | Own warmed mailbox — supports keeping send off LeadConnector. |
| `OUTREACH_ENABLED`, `OUTREACH_CHANNELS`, `PIPELINE_MODES` | Outreach can be disabled while evaluating. Keep it off. |

Shipped skills per the README: `find`, `gather`, `build`, `deploy`, `outreach`, `follow-up`,
`qa-fix`, plus a `qa-reviewer` agent.

### There is nothing to automate — the CLI is setup-only

Extracted from the binary, the complete command surface is:

```
init  install  configure  doctor  preflight  update  pair-whatsapp
```

**No `build`, no `find`, no `outreach` command.** The pipeline is driven by *prompting Claude Code*
against the scaffolded skills, and the vendor documents no headless/CI/cron support. This is an
operator-in-the-loop tool — it cannot be handed to a cron the way `director-build.yml` is dispatched
today. Plan capacity accordingly.

---

## Measured baseline — our own engine's impactlandscapes build

Captured 2026-08-15 against the live `impactlandscapes-net.grayreserve.agency`, screenshots viewed,
contrast computed. This is what Klaudius has to beat.

**Full measured artefact: `baseline/BASELINE.md`** (re-measured 2026-08-15 with pixel-level
verification; raw JSON + scripts committed so every number re-derives). Summary:

| Check | Desktop 1440x900 | Mobile 375x812 |
|---|---|---|
| Nav top | **963px — below the fold**, `position: relative`, `z-index: 2` | **974px — below the fold** |
| Nav off-screen for | **91.0% of the page** (-2037px at scrollY 3000) | 90.9% |
| `h1` top | **1169px — below the fold**, "Request your free Quote." | **1152px — below the fold** |
| Business-info elements in first viewport | **0** | **0** |
| Nav CTA contrast | **2.57:1 — fails AA** (white on `#6AB42F`) | **2.57:1 — fails AA** |
| AA text failures | **7** | 6 |
| JSON-LD | **present** — LocalBusiness/WebSite/WebPage/BreadcrumbList/Service | present |
| Document height | 10,968px | 9,795px |
| Pages / words / photos / hero video | 5 pages · 1,509 words · 11 photos + logo · video present (36.3 MB) | — |

**Looking at it confirms the numbers.** The entire desktop first viewport is a dark video of a man
mowing — no business name, no logo, no nav, no headline, no phone number. The only interface
elements are our own "Make this mine" sales overlay and the chat bubble. Mobile is worse: the video
crops to shrubs and a mower corner, with zero text.

Three corrections to the previously stated audit, from re-measuring:

1. **Our site IS multi-page** — it links `/`, `/services`, `/about`, `/contact`, `/privacy`, with no
   anchor nav. This **raises the bar for TEST 1**: if Klaudius is single-page, it is a structural
   regression against what GR-185 already ships, not merely a shortfall against what it sells.
2. **The chat widget is present and rendering** (visible bottom-right in both viewports). The
   $98/mo chatbot justification is real and live today — which is precisely what `RISK-01` says
   would be lost by moving to an engine that has none.
3. **"Zero services named" holds in substance, not literally.** The prose is genuinely strong —
   "Frisco's blackland clay", "the grade first, then the beds, the plantings and the lawn that sit
   on top of it". But no discrete service is ever named as an offering. **This copy quality is the
   bar `P2-01` must preserve.**

Four further corrections from the 2026-08-15 pixel-verified pass (details in `baseline/BASELINE.md`):

4. **JSON-LD is NOT absent.** `LocalBusiness`, `WebSite`, `WebPage`, `BreadcrumbList` and `Service`
   ship on all four pages, and `llms.txt` + `robots.txt` are present. The defect is the *content*:
   `Service.name` is the placeholder `"Our Services"` and `streetAddress` is corrupt (`"560626 The"`).
   This weakens — but does not remove — the `RISK-01` schema concern: a schema layer exists to port.
5. **Nav CTA contrast is 2.57:1, not 1.11:1.** The earlier "unresolved, do not quote" caveat is
   withdrawn. `a.gr-nav-cta` paints its **own** opaque `#6AB42F`; pixel sampling shows the dominant
   colour in the element crop is `rgb(106,180,47)` at 5,413 of 6,072 px. **2.57:1 is quotable.**
6. **First-viewport text elements are 0, not 1 / 5.** The earlier counts included the off-canvas
   mobile drawer (`left: 486px` on a 375px viewport) and our own "Make this mine" sales pill.
7. **Hero video IS present and playing here** (`readyState: 4`, `paused: false`, 1660x1244, 5.04s) —
   the global warning that recent builds ship without one does not apply to this tenant. It is
   36.3 MB, which is its own problem.

⚠️ Method note worth keeping: on this site the ancestor-walk method for resolving background colour
produced **two false contrast failures** that pixel sampling overturned. Compute the ratio, then
**confirm against rendered pixels** before reporting a contrast defect.

---

## The commercial risk — read before selling anything built on this

GR-185 charges **$598 one-time + $98/month**. The recurring half is justified by hosting, the
chatbot (600 conversations/mo), ongoing SEO/AEO/GEO with reporting, blog content, and the client
editor.

Klaudius's published samples show **no chat endpoint and no per-business schema layer**. If sites
ship that way, **the $98/mo has nothing to stand on until those are built.**

Adopting the shell is cheap. Rebuilding the moat inside it is not. Two specifics:

- Our chatbot is a server endpoint **inside** the Astro previews app
  (`apps/previews/src/pages/api/site-chat.ts`). A Next.js site hosted on its own Vercel project
  needs its own endpoint — that is a **port, not an injection**.
- Our hero video is bound to `assemble-director.mjs`'s slot model (`heroVid`/`heroPoster`, the
  `.gr-hero-plate` pattern, a stale-artifact guard). None of that transfers.

Tracked as `RISK-01` in `.claude/ledger.json`, parked deliberately until Phase 1 reports.

---

## Operating rules for this repo

1. **Never dispatch `director-build.yml`** in `gr-no-website-builds` from here — ~$5 of real money
   per run, and that repo is out of scope for this task.
2. **Never run `klaudius init` / `configure` as the agent.** Credential gate, and the vendor
   explicitly instructs agents to stop.
3. **Run Klaudius STOCK first.** No Higgsfield video, no chatbot, no SEO injection until both
   Phase 1 tests have reported. Jeff's instruction: don't break it before it's measured.
4. **Outreach stays OFF** (`OUTREACH_ENABLED=false`) for the whole evaluation. Nothing sends to a
   real business from an engine being evaluated.
5. **Judge output by looking at it.** Screenshots at 1440x900 and 375x812, viewed. A 200 response
   and a grep are not evidence of quality — that mistake is exactly how our own engine's site got
   called "clean" when it was 4/10.
6. Deploy precedent, when it's time: `gr-no-website-builds/.github/workflows/frame-spec-render.yml`
   — per-tenant Vercel project, subdomain bound as a **Production Domain** on that project
   (`POST /v9/projects/{id}/domains`), Deployment Protection disabled, alias set as belt-and-braces.
   A specific subdomain beats the `*.grayreserve.agency` wildcard. Read it; do not invent a new pattern.
7. **Run the pipeline with `cwd = app/`, never from this repo root.** Not a preference — measured
   2026-08-15. Claude Code identifies a skill by its **directory name**, ignoring `name:`
   frontmatter, and this repo contains three directories called `build`:
   `app/.claude/skills/` (ours), `app/.klaudius/base/.claude/skills/` (the vendor baseline
   `npx klaudius update` diffs against), and `pristine/.claude/skills/` (byte-identical to base).
   From this repo root none of them is a *static* skill source — the root `.claude/` has no
   `skills/` — so they reach a session only through the file-touch-triggered dynamic path, where
   the last-registered copy wins and the registration is cached for the life of the process.
   Worse, from the root `Skill(skill="build")` resolves to SuperClaude's
   `~/.claude/commands/build.md` — a completely unrelated skill. Verified by invoking it: the
   first line came back `# /sc:build - Project Building and Packaging`.
   With `cwd = app/`, `app/.claude/skills` is discovered statically, static sources beat dynamic
   ones by name, and the customised copies win deterministically. Verified the same way: the
   loaded `build` text contained the `anti-ai-slop` bullet, the loaded `deploy` text contained
   `IndexNow ping (all hosts)`. Running from `app/` also makes `app/CLAUDE.md` the project memory
   instead of this file.
8. **Never open `app/.klaudius/base/**` or `pristine/**` with Read/Edit/Write.** A single Read of
   any file under either tree registers that tree's whole skill set and can shadow ours for the
   rest of the session. Both are fenced off by `deny` rules in `.claude/settings.json` here and in
   `app/.claude/settings.json`. Inspect them with `grep`, `diff` or `git` through Bash instead —
   those tools do not trigger skill discovery. Deleting `.klaudius/base` is not an option: the
   updater hardcodes that path as its 3-way-merge baseline.
9. `bash scripts/verify-skill-resolution.sh` asserts all five customisations are present in ours
   and absent from the baseline, that the deny rules survive, and that no fourth skill root has
   appeared. Run it after any `npx klaudius update`.

## Prerequisites still outstanding

Klaudius needs a Supabase project, a Vercel team, a Google Places key, and an email/SMS provider.
Which of these already exist under Gray Reserve accounts is **unconfirmed** — check before the
wizard asks, so Jeff isn't creating duplicates mid-flow.


---

## 2026-08-16 — Design lift and the gates that enforce it

**The failure worth remembering:** a build passed contrast 934/934, ship-scan clean, and PageSpeed
desktop 100/100/100 — and was rated **2/10**. `var(--secondary)` referenced 0 times, 1 gradient,
grain at opacity 0.05, 3 section treatments, and `/ui-ux-pro-max`'s STYLE + KEY EFFECTS silently
dropped. **Every skill ran; the build used about a quarter of what it was handed**, and no gate saw
it because every gate measured CORRECTNESS. Absence is invisible to a validity checker.

**Gates now in the pipeline** (all deterministic scripts, zero model cost):

| script | runs at | blocks on |
|---|---|---|
| `optimise-images.mjs` | before build | — (produces WebP 640/1024/1600/1920) |
| `richness-check.mjs` | QA | unused secondary, <2 gradients, grain <0.08, <3 treatments, un-staggered grids, images >250KB, missing width/height, missing `theme-color`, CVD collapse, sRGB gradients, **dropped design-consult recommendations** |
| `ship-scan.mjs --fix` | QA | secrets, operator paths, source maps, vendor name, AI-slop lexicon; strips html/css comments |
| `contrast-check.mjs` | build + QA | computed WCAG with alpha compositing |
| `prune-client-build.mjs` | deploy | — (530MB -> ~20MB per client) |
| `deploy-and-alias.mjs` | deploy | alias not following the new deployment |

**Colour precedence (settled):** the brand accent is theirs and never overridden; **everything else
colour belongs to `derive-palette` + `color-expert`** because only they can prove 4.5:1 and CVD
separation against this client's real surfaces; `/ui-ux-pro-max` owns layout, style, effects and
typography. Deviating is allowed, silence is not — undocumented drops fail the build.

**Colour method:** choose CHARACTER (deep/vivid/muted/pale/dark) first, harmony second. Six-rung
brand-tinted surface ladder at fixed low chroma — **for a mono-brand client you never invent a
second hue, you build the ladder.**

**Dispatch (the only shape that works):**
```bash
env -u CLAUDECODE -u CLAUDE_CODE CLAUDE_WORKER_CHILD=1 \
  claude -p --permission-mode dontAsk --model opus --effort high "<prompt>"
```
⛔ **Never pass `--mcp-config`** — any form of it hangs `claude -p`, even pointing at an empty
config, and it killed three builds with zero-byte logs. `--effort max` is unreachable (Claude.ai
subscriber gate, a BILLING gate).

✅ **`nohup … &` from a live session IS safe for dispatch — this line previously said otherwise
and was wrong.** Corrected 2026-08-18 (Fable consult) after `scripts/dispatch-build.sh` used
exactly this pattern (`nohup bash scripts/dispatch-build.sh ... &`) across two real dispatches that
survived 65 and 25+ minutes each, across many separate tool calls/turns, with no process-group
kill. `nohup` reparents to PID 1 and detaches from the shell's job control, which is precisely
what avoids the failure this line was warning about — a **bare** `cmd &` with no `nohup`, which
stays in the invoking shell's process group and dies with it when that shell/tool-call ends. The
two are not the same thing; only the bare form is the real risk.

**Two `ui-ux-pro-max` exist.** The build invokes it by relative path, so with `cwd=app/` the VENDOR
copy runs — correct, because it carries 11 data CSVs and 13 stacks including `nextjs`. The
operator's global copy is React Native only. Do not "fix" the path.

## 2026-08-22 craft note
See `app/CUSTOMISATIONS.md` (2026-08-22), `app/services/media-surface/ATMOSPHERE.md`, and gr-brain session `project_klaudius_hf_media_lux_validation_2026_08_22.md`.
