<!--
Split out of deploy/SKILL.md 2026-08-16 (Fable token-cost review): DEPLOY_PROVIDER is fixed
per install and this install runs vercel, so these three providers' ~335 lines were dead weight
injected into every single deploy call. Read this file ONLY when `DEPLOY_PROVIDER` is
`cloudflare`, `netlify`, or `selfhost` — deploy/SKILL.md tells you which section to jump to.
Everything shared across every host (route check, IndexNow ping, alias durability, success
alert, disk reclaim) stays in deploy/SKILL.md itself, not here.
-->

# § Cloudflare Pages

Klaudius builds **static** Next.js sites (`output: 'export'`), so Cloudflare Pages serves the exported `out/` directory directly — no adapter, no Functions, no Workers. Deployment is a direct upload via `wrangler`.

You MUST use this exact sequence. Do not shortcut it.

## Cloudflare auth

Authentication is via the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` environment variables (set by `npx klaudius init`'s wizard, stored in `.env`). `wrangler` reads both names from the environment automatically. **Never run `wrangler login`** — the token is the source of truth, and an interactive OAuth login would diverge from `.env` and stall an unattended pipeline run.

The token needs the **`Account → Cloudflare Pages → Edit`** permission. A `403` at deploy time almost always means the token is under-scoped (missing that permission) or the account ID is wrong — re-create the token per the wizard's instructions before retrying.

We pin `wrangler@4` deliberately: pinning the major version stops a future breaking flag rename from silently breaking deploys. `npx klaudius update` is how a future bump reaches you.

## Deploy commands

```bash
cd clients/$ARGUMENTS/site

# 0. Auth must be present in the environment. A missing token makes wrangler
#    drop to an interactive prompt that would hang this run — fail loudly instead.
[ -n "$CLOUDFLARE_API_TOKEN" ] && [ -n "$CLOUDFLARE_ACCOUNT_ID" ] || { echo "CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID not in environment — is .env loaded?"; exit 1; }

# 0.5. Static sites only: a CMS-enabled site (no static-export `output`
#      setting) cannot ship to Cloudflare Pages — see "Pick the host" at the
#      top. Anchored to the actual config line (quote-tolerant) so a comment
#      that merely mentions the setting can never satisfy the check.
grep -qE "^[[:space:]]*output:[[:space:]]*['\"]export['\"]" next.config.mjs || { echo "This site is a server app (CMS-enabled?) — Cloudflare Pages can't host it. STOP."; exit 1; }

# 1. Build a FRESH static export, so out/ is guaranteed to be THIS client's
#    site and not a stale build left over from QA or an earlier client.
rm -rf out
npm install
npx next build
test -f out/index.html || { echo "out/index.html missing after build — DO NOT deploy"; exit 1; }

# 2. Ensure the Pages project exists, and that it's THIS client's (project
#    assertion — the Cloudflare analogue of Vercel's project-link check).
#    Create it only if absent; never create a suffixed duplicate.
#    CI=1 silences wrangler's interactive nags so `--json` stdout is clean;
#    `txt[txt.index('['):]` is a belt-and-braces strip of any leading banner.
#    NOTE: `pages project list --json` returns a flattened shape whose keys
#    are "Project Name" / "Project Domains" (NOT name/subdomain).
if CI=1 npx wrangler@4 pages project list --json 2>/dev/null | python3 -c "
import sys, json
txt = sys.stdin.read()
data = json.loads(txt[txt.index('['):])
sys.exit(0 if any(p.get('Project Name') == '$ARGUMENTS' for p in data) else 1)
"; then
  echo "project $ARGUMENTS exists — reusing it"
else
  CI=1 npx wrangler@4 pages project create "$ARGUMENTS" --production-branch=main
fi

# 3. Deploy to PRODUCTION. --branch=main MUST match the project's
#    production branch (set at create time). Omitting --branch sends the
#    upload to a throwaway PREVIEW URL instead of the live site.
CI=1 npx wrangler@4 pages deploy out --project-name="$ARGUMENTS" --branch=main --commit-dirty=true
```

## Resolve the real production URL — do NOT assume it

```bash
# 4. Read the project's actual production subdomain back from the API.
#    `pages.dev` subdomains are a GLOBAL namespace: if "$ARGUMENTS" was
#    already taken by some other Cloudflare account, yours gets random
#    characters appended (e.g. acme-roofing-x7k.pages.dev). NEVER construct
#    the URL as https://$ARGUMENTS.pages.dev — read it back.
URL=$(CI=1 npx wrangler@4 pages project list --json 2>/dev/null | python3 -c "
import sys, json
txt = sys.stdin.read()
data = json.loads(txt[txt.index('['):])
proj = next((p for p in data if p.get('Project Name') == '$ARGUMENTS'), None)
assert proj, 'project $ARGUMENTS not found after deploy'
domains = proj.get('Project Domains') or ''
# 'Project Domains' may list more than one host once a custom domain is
# attached; pick the canonical *.pages.dev one (always present).
hosts = [h.strip() for h in domains.replace(',', ' ').split()]
pages = next((h for h in hosts if h.endswith('.pages.dev')), hosts[0] if hosts else '')
assert pages, 'no pages.dev domain on project'
print('https://' + pages)
")
echo "Production URL: $URL"

# 5. Confirm the production URL actually serves the site (200) before we
#    record it or pitch it. This is also the backstop for step 4: if the
#    resolved URL is wrong, the curl fails and we STOP rather than email a
#    dead link to a real business.
test "$(curl -sSL -o /dev/null -w '%{http_code}' "$URL")" = "200" || { echo "$URL did not return 200 — DO NOT record or outreach"; exit 1; }
```

The URL `wrangler` prints on success (e.g. `https://<hash>.$ARGUMENTS.pages.dev`) is the per-deploy **hash** URL — the Cloudflare equivalent of Vercel's deployment-hash URL, and NOT the canonical public URL. It isn't even reliably reachable outside a browser (its deep-subdomain TLS cert can fail a plain `curl`). Never record or pitch it. Always use the project's `pages.dev` domain from step 4.

## Record the URL

```bash
# 6. From the PROJECT ROOT (scripts/ lives there, not in clients/.../site):
cd ../../..
python3 -c "from scripts.db import update_deployed_url; update_deployed_url('$ARGUMENTS', '$URL')"
```
Also record `$URL` in `clients/$ARGUMENTS/data/status.md`.

## Rules
- ALWAYS pass an explicit `--project-name="$ARGUMENTS"`. Never omit it — `wrangler` would otherwise prompt to pick/create a project interactively (hangs the run) or infer one, which risks deploying this client's site into a different client's project and overwriting their live site.
- ALWAYS pass an explicit `--branch=main`. It must equal the `--production-branch` the project was created with. This is the only thing that makes the deploy land on the live production URL instead of a preview.
- ALWAYS reuse the SAME project name (the client slug). Never create suffixed duplicates (`$ARGUMENTS-2`). If re-deploying, step 2 reuses the existing project automatically.
- **Never run `wrangler login`.** The token in `.env` is the only credential.
- **If deployment fails (auth/403, quota, network): STOP.** Do NOT fall back to Vercel, GitHub Pages, or any other host — the operator only configured Cloudflare. Do NOT send outreach. Mark status as "built", and if it's a 403, note the likely token-scope cause, then wait for the operator.

## Post-deploy cleanup (Cloudflare)

After `$URL` is confirmed live (200) AND recorded in Supabase, delete `node_modules` and `out` to free disk space. Prod is on Cloudflare, so this has zero effect on the live site; `npm install && npx next build` reproduces both in ~30s from `package-lock.json`.

```bash
rm -rf clients/$ARGUMENTS/site/node_modules clients/$ARGUMENTS/site/out
```

Only run this after the Supabase `deployed_url` update succeeds. If the deploy failed or `$URL` wasn't captured, do NOT clean up — the site may need to be rebuilt and redeployed.

---

# § Netlify

Klaudius builds **static** Next.js sites (`output: 'export'`), so Netlify serves the exported `out/` directory directly — no adapter, no Functions. We build locally and upload the finished files (`--no-build`), so Netlify never runs a build on its side. Deployment is a direct upload via the Netlify CLI.

You MUST use this exact sequence. Do not shortcut it.

## Netlify auth

Authentication is via the `NETLIFY_AUTH_TOKEN` environment variable (set by `npx klaudius init`'s wizard, stored in `.env`). The Netlify CLI reads it automatically. **Never run `netlify login`** — the token is the source of truth, and an interactive OAuth login would diverge from `.env` and stall an unattended pipeline run.

A personal access token carries full account access, so there's no separate "account ID" to set (unlike Cloudflare). The optional `NETLIFY_ACCOUNT_SLUG` pins which team new sites are created under; left blank, the first team on the token is used — correct for the single-team operator, which is almost everyone.

We pin `netlify-cli@26` deliberately: pinning the major version stops a future breaking flag rename from silently breaking deploys. `npx klaudius update` is how a future bump reaches you.

## Deploy commands

```bash
cd clients/$ARGUMENTS/site
rm -rf .netlify   # no stale link state from a previous run

# 0. Auth must be present in the environment. A missing token makes the
#    Netlify CLI drop to an interactive login that would hang this run —
#    fail loudly instead.
[ -n "$NETLIFY_AUTH_TOKEN" ] || { echo "NETLIFY_AUTH_TOKEN not in environment — is .env loaded?"; exit 1; }

# 0.5. Static sites only: a CMS-enabled site (no static-export `output`
#      setting) cannot ship to Netlify the way Klaudius drives it — see
#      "Pick the host" at the top. Anchored to the actual config line
#      (quote-tolerant) so a comment that merely mentions the setting can
#      never satisfy the check.
grep -qE "^[[:space:]]*output:[[:space:]]*['\"]export['\"]" next.config.mjs || { echo "This site is a server app (CMS-enabled?) — deploy it via § Vercel instead. STOP."; exit 1; }

# 1. Build a FRESH static export, so out/ is guaranteed to be THIS client's
#    site and not a stale build left over from QA or an earlier client.
rm -rf out
npm install
npx next build
test -f out/index.html || { echo "out/index.html missing after build — DO NOT deploy"; exit 1; }

# 2. Find this client's Netlify site, or create it. Sites are keyed by
#    name == client slug (the Netlify analogue of Vercel's project link and
#    Cloudflare's project name). The API's ?name= filter is a substring
#    match, so we re-check for an EXACT name match in python.
SITE_ID=$(curl -sS -H "Authorization: Bearer $NETLIFY_AUTH_TOKEN" \
  "https://api.netlify.com/api/v1/sites?name=$ARGUMENTS&per_page=100" | python3 -c "
import sys, json
sites = json.load(sys.stdin)
m = next((s for s in sites if s.get('name') == '$ARGUMENTS'), None)
print(m['id'] if m else '')
")

if [ -z "$SITE_ID" ]; then
  # Resolve the team slug to create the site under. NETLIFY_ACCOUNT_SLUG
  # overrides; otherwise use the first team on the token (correct for the
  # single-team operator, which is almost everyone).
  SLUG="$NETLIFY_ACCOUNT_SLUG"
  [ -n "$SLUG" ] || SLUG=$(curl -sS -H "Authorization: Bearer $NETLIFY_AUTH_TOKEN" \
    "https://api.netlify.com/api/v1/accounts" | python3 -c "
import sys, json
a = json.load(sys.stdin)
print(a[0]['slug'] if a else '')
")
  [ -n "$SLUG" ] || { echo "Could not resolve a Netlify team slug — token has no team? STOP."; exit 1; }

  # CI=1 suppresses the CLI's interactive/telemetry prompts so they can't
  # pollute the run. JSON goes to stdout, status text to stderr.
  CI=1 npx netlify-cli@26 sites:create --name "$ARGUMENTS" --account-slug "$SLUG" --disable-linking --json > /tmp/netlify-create-$ARGUMENTS.json 2>/tmp/netlify-create-$ARGUMENTS.err
  SITE_ID=$(python3 -c "
import json
t = open('/tmp/netlify-create-$ARGUMENTS.json').read()
i = t.find('{')
d = json.JSONDecoder().raw_decode(t[i:])[0] if i >= 0 else {}
print(d.get('id') or '')
" 2>/dev/null)
  # An empty id here almost always means the name is already taken: Netlify
  # site names share ONE global namespace (like Cloudflare's pages.dev), so
  # `sites:create --name <slug>` fails if another account already owns that
  # name. Fail loudly rather than silently creating a random-named duplicate.
  [ -n "$SITE_ID" ] || { echo "Could not create Netlify site '$ARGUMENTS' — the name is likely taken globally (Netlify site names are a shared namespace). See /tmp/netlify-create-$ARGUMENTS.err. STOP — do not deploy."; exit 1; }
fi

# 3. Deploy the prebuilt out/ to PRODUCTION. --no-build skips any build
#    (we already built locally); --prod targets the live URL (omitting it
#    sends the upload to a throwaway draft URL instead). --json keeps stdout
#    clean for parsing (status text goes to stderr).
CI=1 npx netlify-cli@26 deploy --dir=out --site "$SITE_ID" --prod --no-build --json > /tmp/netlify-deploy-$ARGUMENTS.json
```

## Read the production URL from the deploy output — do NOT assume it

```bash
# 4. The deploy JSON carries the canonical site URL directly — no separate
#    API read-back needed (unlike Cloudflare). `ssl_url` (or `url`) is the
#    live https://<name>.netlify.app. `deploy_url` is the per-deploy DRAFT
#    URL (the Netlify equivalent of Vercel's deployment-hash URL) — never
#    record that one.
URL=$(python3 -c "
import json
t = open('/tmp/netlify-deploy-$ARGUMENTS.json').read()
i = t.find('{')
d = json.JSONDecoder().raw_decode(t[i:])[0] if i >= 0 else {}
print(d.get('ssl_url') or d.get('url') or '')
")
[ -n "$URL" ] || { echo "No URL in deploy output — the deploy likely failed. Do NOT record or outreach; investigate /tmp/netlify-deploy-$ARGUMENTS.json"; exit 1; }
echo "Production URL: $URL"

# 5. Confirm the production URL actually serves the site (200) before we
#    record it or pitch it. This is the backstop for step 4: if the URL is
#    wrong, the curl fails and we STOP rather than email a dead link.
test "$(curl -sSL -o /dev/null -w '%{http_code}' "$URL")" = "200" || { echo "$URL did not return 200 — DO NOT record or outreach"; exit 1; }
```

## Record the URL

```bash
# 6. From the PROJECT ROOT (scripts/ lives there, not in clients/.../site):
cd ../../..
python3 -c "from scripts.db import update_deployed_url; update_deployed_url('$ARGUMENTS', '$URL')"
```
Also record `$URL` in `clients/$ARGUMENTS/data/status.md`.

## Rules
- ALWAYS reuse the SAME site (name == the client slug). Step 2 finds-or-creates idempotently; never create suffixed duplicates (`$ARGUMENTS-2`).
- ALWAYS pass `--prod`. Without it the upload goes to a draft deploy URL, not the live site.
- ALWAYS pass `--no-build`. Klaudius already built `out/` locally; letting Netlify build would be slower and could behave differently from the QA'd build.
- **Never run `netlify login`.** The token in `.env` is the only credential.
- **If deployment fails (auth, quota, name collision, network): STOP.** Do NOT fall back to Vercel, Cloudflare, GitHub Pages, or any other host — the operator only configured Netlify. Do NOT send outreach. Mark status as "built" and wait for the operator.

## Post-deploy cleanup (Netlify)

After `$URL` is confirmed live (200) AND recorded in Supabase, delete `node_modules` and `out` to free disk space. Prod is on Netlify, so this has zero effect on the live site; `npm install && npx next build` reproduces both in ~30s from `package-lock.json`.

```bash
rm -rf clients/$ARGUMENTS/site/node_modules clients/$ARGUMENTS/site/out
```

Only run this after the Supabase `deployed_url` update succeeds. If the deploy failed or `$URL` wasn't captured, do NOT clean up — the site may need to be rebuilt and redeployed.

---

# § Self-host (your own server)

Builds locally, rsyncs the static `out/` to the operator's server over SSH. Config from `.env`: `SELFHOST_DEPLOY_TARGET` (rsync destination base — each client uploads to `<target>/<slug>/`) and `SELFHOST_URL_TEMPLATE` (public URL pattern, e.g. `https://{slug}.sites.example.com`).

You MUST use this exact sequence. Do not shortcut it.

- **SSH keys only.** Never type or script a password — an auth failure means the operator's key isn't on the server; that's theirs to fix (ports/identity files go in their `~/.ssh/config`).
- **`{slug}` stays in the hostname.** A path-based template serves broken pages (root-absolute asset links) even when the page itself returns 200 — never "fix" a failing deploy by moving `{slug}` into the path.
- **If the 200-check fails on a first deploy**, the operator's server isn't configured yet (wildcard DNS + TLS + a vhost mapping subdomain → `<target>/<slug>/`). Offer to help set it up, then re-run `/deploy`.

## Deploy commands

```bash
cd clients/$ARGUMENTS/site

# 0. Config must be present. Fail loudly rather than guessing a target.
[ -n "${SELFHOST_DEPLOY_TARGET:-}" ] && [ -n "${SELFHOST_URL_TEMPLATE:-}" ] || { echo "SELFHOST_DEPLOY_TARGET / SELFHOST_URL_TEMPLATE not in environment — is .env loaded?"; exit 1; }

# 0.5. Static sites only: a CMS-enabled site (no static-export `output`
#      setting) cannot ship to a static file server — see "Pick the host"
#      at the top. Anchored to the actual config line (quote-tolerant) so
#      a comment that merely mentions the setting can never satisfy it.
grep -qE "^[[:space:]]*output:[[:space:]]*['\"]export['\"]" next.config.mjs || { echo "This site is a server app (CMS-enabled?) — a static file server can't host it. STOP."; exit 1; }

# 1. Build a FRESH static export, so out/ is guaranteed to be THIS client's
#    site and not a stale build left over from QA or an earlier client.
rm -rf out
npm install
npx next build
test -f out/index.html || { echo "out/index.html missing after build — DO NOT deploy"; exit 1; }

# 2. Upload to the server. Trailing slash on out/ = sync CONTENTS into the
#    slug directory. --delete removes files a previous deploy left behind,
#    so the server never serves stale assets alongside fresh HTML.
#    BatchMode fails loudly on any auth problem instead of prompting.
#    A failed rsync MUST stop the run: on a re-deploy the 200-check below
#    would pass against the STALE previous upload and record it as fresh.
rsync -az --delete -e "ssh -o BatchMode=yes" out/ "$SELFHOST_DEPLOY_TARGET/$ARGUMENTS/" || { echo "rsync failed (SSH auth or path) — DO NOT record or outreach. STOP."; exit 1; }

# 3. Derive the live URL from the template (constructing it is correct
#    here — the template IS the routing contract the server implements).
URL="${SELFHOST_URL_TEMPLATE//\{slug\}/$ARGUMENTS}"
echo "Production URL: $URL"

# 4. Confirm it serves (200) before recording or pitching. DNS, vhost,
#    and TLS problems all surface here — STOP rather than email a dead
#    link to a real business.
test "$(curl -sSL -o /dev/null -w '%{http_code}' "$URL")" = "200" || { echo "$URL did not return 200 — server not serving this slug yet. DO NOT record or outreach"; exit 1; }
```

## Record the URL

```bash
# 5. From the PROJECT ROOT (scripts/ lives there, not in clients/.../site):
cd ../../..
python3 -c "from scripts.db import update_deployed_url; update_deployed_url('$ARGUMENTS', '$URL')"
```
Also record `$URL` in `clients/$ARGUMENTS/data/status.md`.

## Rules
- ALWAYS upload to the SAME per-slug directory. Re-deploys overwrite it idempotently; never create suffixed duplicates (`$ARGUMENTS-2`).
- **If the rsync or the 200-check fails: STOP.** Do NOT fall back to Vercel, GitHub Pages, or any other host. Do NOT send outreach. Mark status as "built", tell the operator what failed (SSH auth vs missing vhost vs DNS), and wait.

## Post-deploy cleanup (self-host) — then § IndexNow ping below

After `$URL` is confirmed live (200) AND recorded in Supabase, delete `node_modules` and `out` to free disk space. Prod is on the operator's server, so this has zero effect on the live site; `npm install && npx next build` reproduces both in ~30s from `package-lock.json`.

```bash
rm -rf clients/$ARGUMENTS/site/node_modules clients/$ARGUMENTS/site/out
```

Only run this after the Supabase `deployed_url` update succeeds. If the deploy failed or `$URL` wasn't captured, do NOT clean up — the site may need to be rebuilt and redeployed.

---
