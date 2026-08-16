---
name: deploy
description: Deploy a built website to production — Vercel, Cloudflare Pages, Netlify, or your own server (self-host), per DEPLOY_PROVIDER in .env
argument-hint: [business-name]
allowed-tools: Bash(npx *), Bash(npm *), Bash(python3 *), Bash(rm *), Bash(cd *), Bash(cat *), Bash(grep *), Bash(test *), Bash(curl *), Bash(rsync *), Read, Write
---

# Deploy $ARGUMENTS to production

Read `prompts/lessons/deploy.md` before starting.

**Do not pause to confirm the deploy with the user. The skill's checks are the gate** (the project assertion, the production-vs-preview rule, the URL read-back, the curl 200). Only stop if a specific check fails. Adding a generic "ready to deploy?" prompt is exactly the friction this skill exists to remove.

## Pick the host: read `DEPLOY_PROVIDER`

Klaudius deploys to one host per install, chosen at setup time. Read it from `.env`:

```bash
grep -E '^DEPLOY_PROVIDER=' .env | head -1 | cut -d= -f2- | tr -d '"'
```

Whichever host section you run, finish with **§ Route check (all hosts)**, then **§ IndexNow ping (all hosts)**, then **§ Disk reclaim (all hosts)** at the bottom of this file. The disk reclaim is MANDATORY on every deploy: an unpruned client is ~530 MB against ~20 MB pruned, which at 50 builds/day is the difference between 1 GB/day and 26.5 GB/day. The route check proves every subpage serves 200 on the real host; the IndexNow ping is a no-op for sites that haven't been through `/seo`.

If it's `cloudflare`, `netlify`, or `selfhost`, read `.claude/skills/deploy/reference/non-vercel-hosts.md` now and follow that provider's section in it (§ Cloudflare Pages / § Netlify / § Self-host). Anything else (including unset) means Vercel — follow **§ Vercel** below, in THIS file; do not open the reference file at all. Do NOT run more than one provider. Do NOT switch hosts mid-deploy or fall back to another host on failure — the operator only has an account on the one they configured.

**CMS-enabled sites are Vercel-only.** If `clients/$ARGUMENTS/data/cms.md` exists (the `/cms` skill was run for this client), the site is a server app — no `output: 'export'` in its `next.config.mjs` — and it MUST deploy via § Vercel. The Vercel sequence below handles static and server sites identically, no changes needed. If `DEPLOY_PROVIDER=cloudflare`, `netlify`, or `selfhost` AND the site is CMS-enabled, **STOP** and tell the operator: this client's CMS needs server actions and Vercel Blob, so it requires Vercel and can't ship to static hosting.

---

## Pick the serving mode: PROSPECT or CONVERTED CLIENT

**Read this before any host section. It decides whether this deploy creates a Vercel project at all.**

Klaudius builds on spec: most sites go to a business that never asked and mostly never replies. A Vercel project per prospect is therefore a cost we pay before any revenue, and on a **Pro** plan it is also a hard ceiling — Vercel caps projects per team, and the Gray Reserve team was already at **32 projects** against a target of **50-100 builds/day**. Long before the cap it makes the account unmanageable.

So there are two paths, and the default is the cheap one:

| | PROSPECT (default) | CONVERTED CLIENT |
|---|---|---|
| When | Every spec build. The business has not paid. | The lead paid. Same trigger as `/cms` and `/seo`. |
| Served from | The ONE shared multi-tenant app, `gr-no-website-builds` | Its own dedicated Vercel project |
| Address | `{slug}.grayreserve.agency` | Their real domain (plus the subdomain until DNS moves) |
| New Vercel projects | **zero** | one, and it is earned |
| Follow | **§ Shared instance** below | **§ Vercel** below |

```bash
# The pipeline's own status column is the signal — no new config to keep in sync.
# `converted` is the status /cms and /seo already key off. Anything else is a prospect.
#
# ⚠️ RESOLVE PYTHON EXPLICITLY. Bare `python3` on this machine is macOS's system 3.9.6, which has
# NO `supabase` module, so the import throws, `2>/dev/null` swallows it, and STATUS comes back
# EMPTY on every single run. The gate then answers "shared instance" unconditionally — which is
# safe for prospects and therefore invisible, but means a CONVERTED client is also served off the
# shared lane and never gets the dedicated project they paid for. A gate that cannot read its own
# input is not a gate. uv's 3.12 in ~/.local/bin is what the rest of the pipeline uses (see
# app/.claude/settings.json's PATH override). Measured 2026-08-16.
PY=$(for p in "$HOME/.local/bin/python3" python3; do
       "$p" -c 'import supabase' 2>/dev/null && { echo "$p"; break; }; done)
[ -n "$PY" ] || echo "WARN: no python with supabase — STATUS will be empty, defaulting to PROSPECT"
STATUS=$([ -n "$PY" ] && "$PY" -c "
from scripts.db import get_client_by_slug
c = get_client_by_slug('$ARGUMENTS') or {}
print((c.get('status') or '').strip().lower())
" 2>/dev/null || echo '')
if [ "$STATUS" = "converted" ] || [ "${KLAUDIUS_FORCE_DEDICATED:-0}" = "1" ]; then
  echo "SERVING MODE: dedicated project (status=$STATUS) — follow § Vercel"
else
  echo "SERVING MODE: shared instance (status=${STATUS:-unknown}) — follow § Shared instance"
fi
```

If `scripts/db.py` has no `get_client_by_slug` helper, read the status with the Supabase MCP instead (`SELECT status FROM clients WHERE slug = '$ARGUMENTS'`). **A status you could not read is a PROSPECT** — fail toward the path that spends nothing.

`DEPLOY_PROVIDER` still selects the host for the CONVERTED path. The shared instance is Vercel-hosted by construction (it IS a Vercel app), so on a `cloudflare` / `netlify` / `selfhost` install the prospect path still publishes into it — nothing about the operator's own host account is used, because no account of theirs is touched.

**CMS-enabled sites cannot use the shared instance.** `/cms` turns the site into a `force-dynamic` server app, and the shared lane serves static documents only. That is not a conflict in practice: `/cms` runs on PURCHASE (see `CLAUDE.md`), and a purchase is exactly what moves the client onto the dedicated path. If `clients/$ARGUMENTS/data/cms.md` exists, treat the client as CONVERTED and follow § Vercel regardless of status.

---

# § Shared instance (prospects — zero new Vercel projects)

The prospect's static export is published into the **existing** `gr-no-website-builds` Astro app and served on `{slug}.grayreserve.agency` through its `*.grayreserve.agency` wildcard. This mirrors the composer and director lanes that already serve ~80 GR-185 tenants from that one project — the pattern is proven in production, not invented here.

**Nothing here creates, links to, or deploys a per-client Vercel project.** Do not run `vercel link` in this path.

```bash
# 0. Where the shared app lives. One checkout, one Vercel project.
SHARED_REPO="${SHARED_LANE_REPO:-$HOME/Github/gr-no-website-builds}"
ZONE="${GR_SUBDOMAIN_ZONE:-grayreserve.agency}"
TEAM="${VERCEL_SCOPE:-team_i8ra4hL0aEUCXmNX82Pey5WE}"
# RESOLVE THE PUBLISHER, do not assume the main checkout has it. Measured 2026-08-16: the
# publisher lives on `feat/klaudius-shared-lane`, which is NOT merged and NOT pushed, while
# ~/Github/gr-no-website-builds sits on whatever branch another session left checked out (it was
# on `wire/gate-verdict-and-dead-refs` with 44 dirty files). The naive `test -f "$SHARED_REPO/..."`
# therefore fails on a healthy machine, and at 50 builds/day it fails FIFTY times.
#
# NEVER `git checkout` in the shared repo to fix this — it is a shared checkout and switching
# branches destroys another session's uncommitted work. Find a worktree that already has the
# branch, or create one.
if [ ! -f "$SHARED_REPO/scripts/publish-klaudius-tenant.mjs" ]; then
  LANE_WT=$(git -C "$SHARED_REPO" worktree list --porcelain 2>/dev/null \
    | awk '/^worktree /{w=$2} /^branch .*klaudius-shared-lane/{print w; exit}')
  if [ -n "$LANE_WT" ] && [ -f "$LANE_WT/scripts/publish-klaudius-tenant.mjs" ]; then
    SHARED_REPO="$LANE_WT"
    echo "publisher: using existing worktree $SHARED_REPO"
  else
    LANE_WT="${TMPDIR:-/tmp}/gr-shared-lane-$$"
    git -C "$SHARED_REPO" worktree add "$LANE_WT" feat/klaudius-shared-lane >/dev/null 2>&1 \
      && SHARED_REPO="$LANE_WT" && echo "publisher: created worktree $SHARED_REPO"
  fi
fi
test -f "$SHARED_REPO/scripts/publish-klaudius-tenant.mjs" || {
  echo "Shared lane publisher not found on any ref or worktree. The durable fix is merging"
  echo "feat/klaudius-shared-lane into gr-no-website-builds main (ledger SI-09). STOP."; exit 1; }

# 1. A FRESH static export. The shared lane serves whatever is in out/, so a stale
#    out/ ships a stale site to a real prospect. This also asserts the site really is
#    a static export — the whole reason it can be served without its own project.
cd clients/$ARGUMENTS/site
grep -qE "^[[:space:]]*output:[[:space:]]*['\"]export['\"]" next.config.mjs || {
  echo "Not a static export — the shared lane cannot serve a server app. STOP."; exit 1; }
rm -rf out && npx next build

# 2. Publish into the lane. This splits documents (function-served) from assets
#    (filesystem-served) and re-points the asset URLs. It does NOT deploy.
cd - >/dev/null
node "$SHARED_REPO/scripts/publish-klaudius-tenant.mjs" \
  --slug "$ARGUMENTS" \
  --out "clients/$ARGUMENTS/site/out" \
  --name "<the real business name>" \
  --repo "$SHARED_REPO"
```

`vercel.json`'s `/` → `/index` rewrite is a **per-project** deploy concern and is irrelevant here — the shared lane resolves `/` to the `home` document itself. Leave the file in place for the client's eventual conversion; the publisher ignores it.

### 🚨 `next.config.mjs` MUST carry `assetPrefix` — never build without it (added 2026-08-16)

The shared lane serves a tenant's **document** at the subdomain root but its **assets** under
`/klaudius/<slug>/`. Next bakes the asset base into the client runtime at build time, so a build
with no `assetPrefix` ships a runtime that requests its own chunks from the domain root — where
nothing is served — and **never hydrates**.

This fails **completely silently**: the page renders from static HTML, every chunk still returns
200, and the console is empty (a module that is never requested cannot throw). What you actually
get is a dead mobile menu, a chat bubble that will not open, no GSAP/Lenis, and every
`[data-reveal]` frozen at opacity 1 — which looks exactly like a design defect, not a build one.
Two real tenants shipped this way before the cause was found: proven by a controlled comparison —
one build had `assetPrefix` and hydrated, the other didn't and was otherwise **byte-identical**
once the asset paths were normalised.

`templates/trade-site/next.config.mjs` now derives `assetPrefix` from the client directory name at
build time (`/klaudius/<slug>`), so a fresh `cp -r templates/trade-site` already carries it — **do
not hand-edit it out.** If you ever touch `next.config.mjs` for a client-specific reason, verify the
`assetPrefix` line survives your edit. To confirm a build actually hydrates before deploying:
`grep -c '"/_next/static' clients/<slug>/site/out/index.html` must be **0** (a bare, un-prefixed
path means the config was missing or ignored).

```bash
# 3. Commit the tenant into the shared repo. That repo has ~34 registered worktrees
#    and concurrent agents, so a bare `git commit` would swallow another lane's
#    staged files. Scope it, then VERIFY what actually got committed.
cd "$SHARED_REPO"
git add -A "apps/previews/src/klaudius/$ARGUMENTS" "apps/previews/public/klaudius/$ARGUMENTS"
git commit --only -- "apps/previews/src/klaudius/$ARGUMENTS" "apps/previews/public/klaudius/$ARGUMENTS" \
  -m "[klaudius] $ARGUMENTS"
git show --stat --name-only HEAD | head -20   # every path must be under klaudius/$ARGUMENTS
```

```bash
# 4. Deploy the shared app ONCE. Tenants are compiled in by `import.meta.glob(...,
#    { eager: true })`, so a committed tenant is NOT a live tenant until this runs.
#    BATCH: if you published several prospects this session, publish and commit them
#    all first, then run this step once. Each deploy is a full app build.
npx vercel pull --token=$VERCEL_TOKEN --scope=$TEAM --yes --environment production
npx vercel build --prod --token=$VERCEL_TOKEN
npx vercel deploy --token=$VERCEL_TOKEN --prebuilt --prod --yes 2>&1 | tee /tmp/vercel-shared-deploy.log
TARGET=$(grep -aoE 'https://[a-z0-9._-]+\.vercel\.app' /tmp/vercel-shared-deploy.log | head -1)

# 5. Register the subdomain as a PRODUCTION DOMAIN on the shared project (idempotent),
#    then re-point the aliases at the deployment just built. An alias-only pin hits
#    Vercel SSO Deployment Protection and 401s; a production domain does not.
npx vercel domains add "$ARGUMENTS.${ZONE}" gr-no-website-builds --token=$VERCEL_TOKEN --scope=$TEAM \
  || echo "domains add non-2xx (already bound is fine)"
TARGET_DEPLOYMENT="${TARGET#https://}" bash scripts/sync-subdomain-aliases.sh
```

**`vercel domains add` is not optional, and an alias is not a substitute for it.** Measured 2026-08-15: with the subdomain pinned only by `vercel alias set`, the root path returned **302 to `vercel.com/sso-api`** on both a preview and a production deployment. The shared project's `ssoProtection` is `all_except_custom_domains`, and that exemption applies to a registered **Production Domain** — not to an alias. The moment the domain was POSTed to `/v9/projects/{id}/domains` the same URL returned 200. A prospect who clicks an SSO wall is a dead lead, so do not skip this step or conclude from a 302 that the build is broken.

Do **not** PATCH `ssoProtection` on the shared project. It is already set to `all_except_custom_domains`, which is exactly right: the deployment URL stays protected while every `*.grayreserve.agency` tenant serves publicly. Turning it off entirely would expose ~80 tenants' deployment URLs.

```bash
# 6. Verify the URL THAT WILL BE EMAILED, at the ROOT path with a trailing slash.
#    A subpage or /index returning 200 proves nothing about `/`.
cd -  >/dev/null
PUBLIC_URL="https://$ARGUMENTS.${ZONE}"
CODE=""
for i in 1 2 3 4 5 6 7 8 9 10; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$PUBLIC_URL/" || true)
  [ "$CODE" = "200" ] && break
  echo "poll $i: $PUBLIC_URL/ -> ${CODE:-ERR}; retrying in 15s"; sleep 15
done
[ "$CODE" = "200" ] || { echo "$PUBLIC_URL/ never reached 200 (last: ${CODE:-ERR}). Do NOT record it and do NOT outreach — a wrong value here is a dead link in a real send. STOP and investigate."; exit 1; }
echo "Live: $PUBLIC_URL"
```

```bash
# 7. Record it. This is the value the GHL mirror copies into contact.gr185_demo_url
#    and the GR-598 workflow puts in the prospect's email, so it MUST be the URL that
#    just returned 200 — never a constructed guess, never a vercel.app deployment URL.
python3 -c "from scripts.db import update_deployed_url; update_deployed_url('$ARGUMENTS', '$PUBLIC_URL')"
```

There is deliberately **no vercel.app fallback** on this path. The dedicated path falls back to its project alias because one exists; here the subdomain is the only address the tenant has, so a subdomain that never serves means the deploy did not work — recording anything else would record a link that is not the site.

Then run **§ Route check (all hosts)** and **§ IndexNow ping (all hosts)** as normal, against `$PUBLIC_URL`. Skip § Post-deploy cleanup's `rm -rf node_modules` only if you intend to rebuild this client shortly; it is otherwise safe.

### When a prospect converts

Re-run `/deploy` once the status is `converted`. It takes § Vercel, creates the client's own project, and binds their real domain. Leave the shared-lane tenant committed until their domain is live, so the link already sent to them keeps working; remove `apps/previews/{src,public}/klaudius/{slug}` and redeploy the shared app once it is not.

---

# § Vercel

**Only for CONVERTED clients** (see § Pick the serving mode). On a prospect this creates a Vercel project we have not been paid for, against a Pro plan that caps them — use § Shared instance instead.

You MUST use this exact 5-command sequence. Do not substitute, shorten, or "shortcut" any of it.

## Vercel auth

Authentication is via the `VERCEL_TOKEN` environment variable (set by `npx klaudius init`'s wizard, stored in `.env`). Every `vercel` command below MUST be run with `--token=$VERCEL_TOKEN`. **Never run `vercel login`** — the token is already the source of truth, and login state in `~/.vercel/auth.json` would diverge from `.env` and confuse later runs.

### Scope (multi-team Vercel accounts only)

Most operators have a single-scope Vercel account and `vercel link` picks the scope automatically — `VERCEL_SCOPE` in `.env` is blank and the `${VERCEL_SCOPE:+--scope=$VERCEL_SCOPE}` expansion below resolves to nothing. If `vercel link` errors complaining about scope (post-2024 Vercel accounts auto-create a team scope rather than using a personal one, so `--scope` is needed even with a single team), open `.env`, set `VERCEL_SCOPE` to the team slug from `npx vercel teams ls --token=$VERCEL_TOKEN`, and re-run the deploy.

## Deploy commands

```bash
cd clients/$ARGUMENTS/site

# Static-export sites MUST carry the scaffold's vercel.json. Its single
# `/` → `/index` rewrite is the only thing that stops a --prebuilt deploy
# serving 404 at the homepage (Next 16 + Vercel CLI 59 re-home index.html
# onto the serving path `index`; nothing then maps `/` onto it, so `/index`,
# subpages and assets all return 200 while `/` — the URL that goes into the
# outreach email — returns 404). CMS sites are server apps and must NOT have
# it. Verified by deploy 2026-08-15.
if grep -qE "^[[:space:]]*output:[[:space:]]*['\"]export['\"]" next.config.mjs; then
  test -f vercel.json || printf '%s\n' '{' '  "$schema": "https://openapi.vercel.sh/vercel.json",' '  "rewrites": [{ "source": "/", "destination": "/index" }]' '}' > vercel.json
  grep -q '"/index"' vercel.json || { echo "vercel.json exists but has no / -> /index rewrite — homepage will 404. STOP and fix it."; exit 1; }
else
  rm -f vercel.json   # server app (CMS): the rewrite would 404 the homepage
fi

rm -rf .vercel
npx vercel link --token=$VERCEL_TOKEN ${VERCEL_SCOPE:+--scope=$VERCEL_SCOPE} --yes --project $ARGUMENTS
npx vercel pull --token=$VERCEL_TOKEN --yes --environment production
npx vercel build --prod --token=$VERCEL_TOKEN
npx vercel deploy --token=$VERCEL_TOKEN --prebuilt --prod --yes 2>&1 | tee /tmp/vercel-deploy-$ARGUMENTS.log
```

After `vercel link`, verify the link landed on the right project before deploying:
```bash
cat .vercel/project.json | python3 -c "import sys,json; p=json.load(sys.stdin); assert p['projectName']=='$ARGUMENTS', f'WRONG PROJECT: {p[\"projectName\"]}'; print('linked correctly')"
```
If this assertion fails, **STOP**. Do not proceed to the deploy step.

## Rules
- ALWAYS use the SAME project slug. If re-deploying, check status.md or Supabase (`python3 scripts/db.py client $ARGUMENTS`) for the existing project name.
- Never create duplicate Vercel projects with suffixes.

### CRITICAL — never use the shortcut form
**Never run `vercel --prod`, `vercel --prod --yes`, `vercel --prod --cwd <path>`, or any variant that does not include an explicit `vercel link --project <slug>` step first.**

Why: when `vercel deploy` runs without an explicit project link, Vercel infers the project name from the cwd folder name. Since every client's deploy folder is `clients/<slug>/site`, the cwd folder name is always `site`, and the deploy lands in a generic Vercel project named `site`. If a Vercel project named `site` already exists in the account (perhaps from a previous mistaken deploy), and any client's custom domain is attached to it, **the shortcut hijacks that domain and overwrites the live client site with whatever you were trying to deploy**. This has happened in production — using the shortcut once is enough to destroy a paying client's website. Always use the explicit 5-command sequence.

Concretely banned patterns:
```bash
# ❌ ALL OF THESE ARE WRONG
vercel --prod --yes --cwd clients/$ARGUMENTS/site
vercel --prod --cwd clients/$ARGUMENTS/site
npx vercel --prod
npx vercel deploy --prod  # without prior `vercel link --project`
```

Only the 5-command sequence at the top of this section is correct. If something goes wrong, fix the root cause — never substitute a shortcut.
- After deploying, read the **production alias** URL from the captured deploy output (NOT the deployment hash URL):
  ```bash
  # `vercel deploy --prod` prints the public production alias on an "Aliased" line.
  # The colon is NOT reliable: Vercel CLI 59.1.3 prints `▲ Aliased         https://…`
  # with no colon at all, so a `grep 'Aliased:'` finds nothing, ALIAS comes back
  # empty, and a perfectly good deploy is reported as a failure. Measured
  # 2026-08-15 against CLI 59.1.3. Keep the colon optional.
  # (The "Production:" line is the deployment-HASH URL — it sits behind Vercel's
  # Deployment Protection auth wall, so never record that one.) Read the alias from
  # the deploy log captured above. This is scope-agnostic and avoids `vercel inspect`,
  # which now requires a deployment URL (NOT a project slug) and errors on a slug.
  ALIAS=$(grep -aiE 'Aliased:?[[:space:]]' /tmp/vercel-deploy-$ARGUMENTS.log | grep -aoE 'https://[a-z0-9._-]+\.vercel\.app' | head -1)
  # No "Aliased" line means the production deploy did not complete/alias. Do NOT
  # reconstruct the URL from the slug: Vercel truncates long slugs (>~35 chars), so
  # https://<slug>.vercel.app is simply wrong for them, and on a RE-deploy a guessed
  # URL can resolve to the STALE prior deploy and still pass a 200 check — recording
  # that and pitching it would send a stale site. So treat a missing alias as failure.
  if [ -z "$ALIAS" ]; then
    echo "No production alias in deploy output — the deploy likely failed. Do NOT record or outreach; investigate."
  else
    # Sanity-confirm the public alias serves before recording it. Check the
    # ROOT path with an explicit trailing slash — that is the URL outreach
    # sends, and it is the one that regresses. `/index` returning 200 proves
    # nothing: in the 2026-08-15 static-export bug `/index`, every subpage and
    # every asset served 200 while `/` served 404.
    test "$(curl -sS -o /dev/null -w '%{http_code}' "$ALIAS/")" = "200" \
      || echo "Alias $ALIAS/ not serving 200 at the ROOT path — do NOT record or outreach; investigate"
    echo "Production alias: $ALIAS"
  fi
  ```
- Bind `$ARGUMENTS.grayreserve.agency` as a **Production Domain** on this client's project, so the client keeps a working Gray Reserve address (rather than a `*.vercel.app` one) for the window between conversion and their real domain's DNS landing. Ported from `gr-no-website-builds/.github/workflows/frame-spec-render.yml`, which has run this pattern in production — do not invent a different one. **Converted clients only.** On a prospect this whole section is skipped: the subdomain is served by the shared instance, and pointing it at a per-client project here would silently take the tenant off the shared lane and spend a project.
  ```bash
  # A PRODUCTION DOMAIN (not merely a deployment alias) persists across every
  # future `vercel deploy --prod`. POST is idempotent: an already-bound domain
  # comes back as the existing record rather than an error.
  PID=$(node -e "process.stdout.write(require('./.vercel/project.json').projectId)")
  ZONE="${GR_SUBDOMAIN_ZONE:-grayreserve.agency}"
  TEAM="${VERCEL_SCOPE:-team_i8ra4hL0aEUCXmNX82Pey5WE}"
  curl -sf -X POST \
    "https://api.vercel.com/v9/projects/${PID}/domains?teamId=${TEAM}" \
    -H "Authorization: Bearer ${VERCEL_TOKEN}" -H "content-type: application/json" \
    -d "{\"name\":\"$ARGUMENTS.${ZONE}\"}" > /dev/null \
    || echo "Production Domain POST non-2xx — falling back to the alias below"
  # Belt-and-braces: the per-deployment alias resolves immediately, without
  # waiting on DNS propagation for a freshly added domain.
  npx vercel alias set "$ALIAS" "$ARGUMENTS.${ZONE}" \
    --token="$VERCEL_TOKEN" --scope="$TEAM" \
    || echo "alias set failed (non-fatal — the Production Domain is the durable binding)"
  # New Vercel projects ship with Deployment Protection ON, which makes the
  # custom domain answer 401. A prospect clicking an auth wall is a dead lead.
  curl -s -X PATCH \
    "https://api.vercel.com/v9/projects/${PID}?teamId=${TEAM}" \
    -H "Authorization: Bearer ${VERCEL_TOKEN}" -H "content-type: application/json" \
    -d '{"ssoProtection":null,"passwordProtection":null}' > /dev/null

  # The subdomain is what goes in the outreach email, so IT is what must be
  # verified — not the vercel.app alias. TLS cert issuance lags a beat on a
  # newly bound domain, hence the poll. Root path with trailing slash.
  PUBLIC_URL="https://$ARGUMENTS.${ZONE}"
  CODE=""
  for i in 1 2 3 4 5 6 7 8 9 10; do
    CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$PUBLIC_URL/" || true)
    [ "$CODE" = "200" ] && break
    echo "poll $i: $PUBLIC_URL/ -> ${CODE:-ERR}; retrying in 15s"; sleep 15
  done
  if [ "$CODE" = "200" ]; then
    echo "Live: $PUBLIC_URL"
  else
    echo "$PUBLIC_URL/ never reached 200 (last: ${CODE:-ERR}). Record the vercel.app alias instead and investigate — do NOT pitch a URL that does not serve."
    PUBLIC_URL="$ALIAS"
  fi
  ```
- Record the URL in `clients/$ARGUMENTS/data/status.md` and update Supabase. Record `$PUBLIC_URL` — the subdomain when it verified, the vercel.app alias when it did not. This is the value the GHL mirror copies into `contact.gr185_demo_url` and the workflow puts in the prospect's email, so a wrong value here is a dead link in a real send:
  ```bash
  python3 -c "from scripts.db import update_deployed_url; update_deployed_url('$ARGUMENTS', '$PUBLIC_URL')"
  ```
- **If deployment fails (rate limit, quota, auth error): STOP.** Do NOT deploy to GitHub Pages or any other platform. Do NOT send outreach. Mark status as "built" and wait for the user to resolve the issue.

## Post-deploy cleanup (Vercel)

After the alias URL is confirmed live AND recorded in Supabase, delete `node_modules` to free disk space. Prod is on Vercel, so this has zero effect on the live site. If future edits are needed, `npm install` reproduces `node_modules` in ~30s from `package-lock.json` (which stays committed).

```bash
rm -rf clients/$ARGUMENTS/site/node_modules
```

Only run this after the Supabase `deployed_url` update succeeds. If the deploy failed or the alias URL wasn't captured, do NOT clean up — the site may need to be rebuilt and redeployed.

---

# § Non-Vercel hosts (Cloudflare Pages, Netlify, self-host)

**Read `.claude/skills/deploy/reference/non-vercel-hosts.md` now, only if `DEPLOY_PROVIDER` is
`cloudflare`, `netlify`, or `selfhost`.** It has the full, exact sequence for each — auth,
build, deploy, URL resolution, and post-deploy cleanup — in the same rigor as the Vercel section
above. This install runs `DEPLOY_PROVIDER=vercel` (see "Pick the host" at the top of this file),
so on a normal run you will never need it — do not read it "just in case".

---

# § Route check (all hosts) — run BEFORE the IndexNow ping

These sites are multi-page (build skill § Site structure). The host-specific block above proved
`/` serves 200; this proves the rest do. It matters because the extensionless paths are the only
ones a visitor or a nav link ever uses, and the host serves them from `services.html` via its own
clean-URL handling — something no local `python3 -m http.server` reproduces, so this is the FIRST
place the real behaviour is observable. A prospect clicking "Services" into a 404 is a dead lead.

```bash
BASE="${ALIAS:-$URL}"; BASE="${BASE%/}"
# Enumerate the routes the build actually produced — never a hardcoded list, since the builder
# drops routes the gathered content could not support (and records that in status.md).
#
# Two portability traps, both already paid for in this repo:
#   * BSD sed (macOS) has no `\?` in BRE, so `s|/\?page\.tsx$||` silently does nothing. It is the
#     same trap that once had IndexNow POSTing the literal host "https:". Separate -e's instead.
#   * This runs under zsh, which does NOT word-split unquoted variables, so `ROUTES=$(...)` plus
#     `for R in $ROUTES` loops exactly ONCE on the whole string and every subpage goes unchecked
#     while the block still looks like it ran. Pipe into `while read` — correct in bash and zsh.
( cd "clients/$ARGUMENTS/site/src/app" 2>/dev/null && \
  find . -name 'page.tsx' -not -path './admin/*' \
  | sed -e 's|^\./||' -e 's|page\.tsx$||' -e 's|/$||' ) \
| while IFS= read -r R; do
    CODE=$(curl -sSL -o /dev/null -w '%{http_code}' --max-time 20 "$BASE/$R")
    echo "$BASE/$R -> $CODE"
    [ "$CODE" = "200" ] || echo "  ^^ NOT SERVING 200 — do NOT record or outreach; the nav links into a 404"
  done
```

The home route falls out of that pipeline as an empty string, so the first line checks `$BASE/`
— which is also what catches the static-export `/` 404 that the scaffold `vercel.json` exists to
prevent. If a subpage fails while `/` succeeds, the deploy is half-broken in the way that is
hardest to notice: the home page a screenshot shows is fine and every link off it is dead. Fix
before recording the URL.

# § IndexNow ping (all hosts)

Run this after the host section, from the **project root**, once the live URL is confirmed and recorded. It re-notifies Bing, Yandex, Naver, Seznam and Yep that the site changed. Every redeploy is a content change worth pushing — `/seo` only ever pings once, at go-live, so without this a CMS edit, a rebuild, or a `/booking` retrofit ships silently.

Two things it deliberately is not: it is **not** a Google mechanism (Google doesn't participate in IndexNow — the sitemap in robots.txt and Search Console remain Google's only path), and it is **not** a gate. A failed ping never blocks a deploy or an outreach send.

```bash
# 0. No key means /seo hasn't run for this client yet — nothing to ping. Not an error.
KEYFILE="clients/$ARGUMENTS/data/indexnow-key"
test -s "$KEYFILE" || echo "no IndexNow key for $ARGUMENTS (/seo not run yet) — skipping ping"

if [ -s "$KEYFILE" ]; then
  INDEXNOW_KEY=$(cat "$KEYFILE")
  # 1. Submit the CANONICAL host from seo.md when one exists (a converted client is on
  #    their own domain; the host URL would be the wrong host to claim). Fall back to the
  #    deploy URL captured above ($ALIAS on Vercel, $URL elsewhere).
  BASE=$(grep -aoE 'https://[a-zA-Z0-9._-]+' "clients/$ARGUMENTS/data/seo.md" 2>/dev/null | head -1)
  [ -n "$BASE" ] || BASE="${ALIAS:-$URL}"
  BASE="${BASE%/}"
  # Shell expansion, NOT sed: BSD sed (macOS) has no `\?` in BRE, so `sed 's|https\?://||; s|/.*||'`
  # yields the literal "https:" and IndexNow answers 400 "URL is not valid url."
  HOST=${BASE#*://}; HOST=${HOST%%/*}

  # 2. The key file must serve FROM THIS HOST — that is the whole ownership check. A key
  #    borrowed from another domain (grayreserve.com's included) can never verify here.
  if [ "$(curl -sSL -o /dev/null -w '%{http_code}' "$BASE/$INDEXNOW_KEY.txt")" = "200" ]; then
    curl -sS -X POST "https://api.indexnow.org/indexnow" \
      -H "Content-Type: application/json; charset=utf-8" \
      -d "{\"host\":\"$HOST\",\"key\":\"$INDEXNOW_KEY\",\"keyLocation\":\"$BASE/$INDEXNOW_KEY.txt\",\"urlList\":[\"$BASE/\"]}" \
      -o /dev/null -w 'IndexNow HTTP %{http_code}\n'
  else
    echo "IndexNow key file not serving at $BASE/$INDEXNOW_KEY.txt — skipping ping (re-run /seo Step 5)"
  fi
fi
```

`200` = accepted and key verified. `202` = accepted, key verification pending (a wrong key also returns 202, so it proves nothing on its own — that is what the key-file check above is for). `400` = the key was empty. Note a non-200 in `status.md` and carry on.

---

# § Alias durability (Vercel, any hostname we pin by hand) — run on EVERY prod deploy

If a hostname was pinned with `vercel alias set` rather than bound as a **Production Domain**, it
does **not** follow later production deploys. It stays bolted to the one deployment it was pointed
at, and nothing errors — the deploy reports success, the project looks healthy, and the hostname
quietly serves stale code.

Observed live 2026-08-16 on the chat service: after a redeploy,
`chat.grayreserve.agency/api/health` returned the NEW code while the same host's page title served
the OLD one. Two different answers from one hostname, because the alias pointed at an intermediate
deployment. Every future deploy would have reverted it again.

So the re-point is part of deploying, not a thing to remember:

```bash
node scripts/deploy-and-alias.mjs <hostname> --cwd <project-dir>
node scripts/deploy-and-alias.mjs <hostname> --project <name> --alias-only   # already deployed
```

It deploys, resolves the deployment that was just created, re-points the hostname, and then
**proves the move** by comparing the `x-vercel-id` the hostname actually serves against the
deployment it aliased — exiting non-zero if they disagree. Re-aliasing without that check would
just move the silent failure one step later.

**The durable fix is still a Production Domain** (`POST /v9/projects/{id}/domains`), which
auto-follows production and needs no re-pointing at all. That route needs a token, so it is a
credential operation for the operator. This script reaches the same end state through the CLI's
existing login, at the cost of running every time.

⚠️ Two CLI traps this script encodes, both of which produced wrong answers before it existed:
- `vercel` writes its human-readable output to **STDERR**. `vercel … 2>/dev/null | grep` silently
  yields nothing and `grep -c` reports `0` — which once read as "deletion succeeded" immediately
  after a deletion that had failed. Capture both streams.
- `--yes` is **not a valid flag** on CLI 59.1.3 and fails the whole command; `--non-interactive`
  makes prompts self-close with an error. Plain `deploy --prod` is the form that works.

⚠️ A hostname that fails TLS outright (`SSL_ERROR_SYSCALL`, no certificate) is usually **not**
broken bindings — Vercel issues certificates asynchronously, so a freshly bound hostname can show
exactly that for a few minutes and then recover on its own. Re-check before treating it as a fault.

---

# § Success alert (all hosts) — MANDATORY, run after the route check

Jeff asked for this explicitly and it was never wired: *"will telegram tell me when builds are
complete with a URL like: Build for COMPANY NAME is here: URL — CRM Created, Smart List Applied …
instead of just failures?"* Until 2026-08-16 this skill contained **zero** `notify.sh` calls, so a

> ⚠️ **Terminal events only.** `NOTIFY_CHANNEL` fans out to two channels, so one call is two
> messages. Alert here ONLY if this failure stops the pipeline or needs a human now. Stage
> progress must stay silent — see CLAUDE.md § Alerting.
successful deploy was silent and only failures ever reached a phone. An operator running 50 builds
a day cannot tell "working" from "wedged" without it.

```bash
bash scripts/notify.sh "Gray Reserve Builder — $NAME is live
$PUBLIC_URL
$PAGES pages · CRM: $CRM_STATE"
```

Compose the three facts from what this run actually did, and never assert one you did not verify:
- `$NAME` — the real business name.
- `$PUBLIC_URL` — the URL the **route check above** returned 200 for. Not the alias you intended,
  not the deployment URL: the one proven live. A success alert carrying a dead link is worse than
  no alert, because it stops the operator checking.
- `$CRM_STATE` — `contact + opportunity created, tagged demo-built` when the GHL mirror ran and
  reported success; `mirror skipped (OUTBOUND_SENDER=mailbox)` when it did not; `CRM FAILED — see
  log` if it errored. Never claim CRM state you did not observe.

**Say "Gray Reserve Builder", never the build tooling's name** (Jeff, 2026-08-16: *"the message
should say 'Gray Reserve Builder' not Klaudius"*). These alerts land in a shared Slack where other
people read them.

Alerting is not gating: if `notify.sh` fails, log it and carry on — the site is already live and a
missed alert must never roll back a good deploy.

---

# § Disk reclaim (all hosts) — MANDATORY final step

Run this after the IndexNow ping, on **every** deploy, every host. It is not optional and not a
"when the disk gets tight" step: at the 50-builds/day target the difference is the machine staying
usable versus filling up mid-week.

```bash
node scripts/prune-client-build.mjs "$ARGUMENTS"
```

**The numbers, measured 2026-08-16 across six real client folders — not estimated:**

| | per client | at 50 builds/day |
|---|---|---|
| raw, untouched | ~530 MB | **26.5 GB/day** — 118 GB of free disk gone in 4½ days |
| after this step | ~20 MB | 1 GB/day |
| after `--archive` (see below) | ~9 MB | 480 MB/day |

Almost all of it is `site/node_modules` (~460 MB) and `site/.next` (~50-130 MB). Both are
regenerable, and `.vercel/output` is the deploy artefact that already lives on the host. The only
irreplaceable part of a client folder is ~15-20 MB of generated source, `data/` and `screenshots/`.

**Why this is safe here specifically:** by the time you reach this section the site is deployed and
the route check has proven it serves. The local `node_modules` has no further job. `/cms` on
conversion re-installs dependencies itself, and `/build`'s retrofit guard keys on `data/cms.md`,
which the pruner never touches.

**The script refuses far more often than it acts, by design.** It prunes only when the Supabase
status is deployed-or-later AND `deployed_url` is non-empty AND no *file* under the client has been
written in the last 10 minutes. The freshness check is the one that protects a concurrently-running
build in a parallel pool, and `--force` (which skips the two DB checks) deliberately cannot skip it.

⚠️ **Do NOT add `--archive` to this step.** Archiving tars the client and **deletes the working
folder**, and `/outreach` still reads `clients/<slug>/` after deploy — in `OUTBOUND_SENDER=mailbox`
mode outreach runs immediately after this. Archiving here would pull the files out from under the
very next skill in the pipeline.

**Archiving is a separate, later sweep**, for clients that have gone cold (outreach sent, sequence
finished, no reply):

```bash
node scripts/prune-client-build.mjs <slug> --archive     # -> ~/Github/klaudius/archive/<slug>.tgz
ARCHIVE_DIR=/path/to/synced/folder node scripts/prune-client-build.mjs <slug> --archive
```

`ARCHIVE_DIR` may point at a cloud-sync folder — tarballs are ~5-9 MB and few, so they sync fine.
**Never relocate the working `clients/` tree itself onto a sync folder:** `node_modules` is
hundreds of thousands of tiny files and the sync daemon will thrash against every install.

Restore an archived client with `tar -xzf archive/<slug>.tgz -C clients/` then
`cd clients/<slug>/site && npm install`.
