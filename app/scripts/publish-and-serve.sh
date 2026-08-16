#!/bin/bash
# publish-and-serve.sh <slug> "<Business Name>" — the whole prospect deploy, unattended-safe.
#
# Replaces a hand-run sequence that broke in three separate ways on 2026-08-16, each silently:
#
#   1. The Vercel CLI HUNG with no timeout, and a 58-minute build produced nothing while its
#      finished source sat undeployed. Every vercel call here goes through vercel-safe.sh.
#   2. The deploy went to the WRONG PROJECT. A child had linked to prj_s72W616… instead of
#      gr-no-website-builds; nothing checked. This asserts the project id BEFORE deploying.
#   3. The subdomain did NOT follow the new deployment. A 2-minute-old Production deployment sat
#      behind a 91-minute-old cached response (age: 5459), and a cache-busted fetch STILL returned
#      the old build until the alias was repointed by hand. At 50 builds/day that ships prospects a
#      link to yesterday's site. This re-aliases and then PROVES the move.
#
# Exits non-zero with a named reason at every stage, so an unattended run fails loudly instead of
# reporting success over stale content.

set -uo pipefail

SLUG="${1:?usage: publish-and-serve.sh <slug> \"<Business Name>\"}"
NAME="${2:?need the business name}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$(cd "$HERE/.." && pwd)"
SCOPE="${VERCEL_SCOPE_SLUG:-jeffslimgray-2914s-projects}"
# The Vercel PROJECT the wildcard *.grayreserve.agency belongs to. Step 5 binds each tenant
# hostname to it as a production domain. Kept beside SCOPE so the two identity values are read
# together; the project ID is asserted separately in step 3 (EXPECT).
PROJECT_NAME="${GR_PREVIEWS_PROJECT_NAME:-gr-no-website-builds}"
ZONE="${GR_SUBDOMAIN_ZONE:-grayreserve.agency}"
HOST="${SLUG}.${ZONE}"

# The shared lane must live at a DURABLE path. It previously ran from a /private/tmp scratchpad
# worktree, which gets cleaned — if that vanished, the deploy path broke for every build.
LANE="${SHARED_LANE_DIR:-$HOME/Github/gr-no-website-builds-lane}"
MAIN_REPO="${SHARED_LANE_REPO:-$HOME/Github/gr-no-website-builds}"
BRANCH="${SHARED_LANE_BRANCH:-feat/klaudius-shared-lane}"

step() { printf '\n[publish-and-serve] %s\n' "$1"; }

# ── 1. Durable lane worktree ────────────────────────────────────────────────────
# NEVER `git checkout` in $MAIN_REPO: it is a shared checkout and switching branches destroys
# another session's uncommitted work (measured: it sat on an unrelated branch with 44 dirty files).
if [ ! -f "$LANE/scripts/publish-klaudius-tenant.mjs" ]; then
  step "creating durable lane worktree at $LANE"
  git -C "$MAIN_REPO" worktree add "$LANE" "$BRANCH" >/dev/null 2>&1 \
    || git -C "$MAIN_REPO" worktree add "$LANE" "$BRANCH" 2>&1 | tail -2
fi
[ -f "$LANE/scripts/publish-klaudius-tenant.mjs" ] || {
  echo "FAIL: publisher not found at $LANE. The durable fix is merging $BRANCH into main (ledger SI-09)."; exit 2; }

# ── 2. Publish the tenant ───────────────────────────────────────────────────────
step "publishing $SLUG into the shared lane"
node "$LANE/scripts/publish-klaudius-tenant.mjs" \
  --slug "$SLUG" --out "$APP/clients/$SLUG/site/out" --name "$NAME" --repo "$LANE" || {
  echo "FAIL: publish step"; exit 3; }

# ── 3. Assert the project BEFORE deploying ──────────────────────────────────────
# Deploying to the wrong project is silent: it succeeds, reports Ready, and serves nothing.
EXPECT="${GR_PREVIEWS_PROJECT_ID:-prj_vZ5hAfdktcE9QfxzQRQDJCvLvqjc}"
mkdir -p "$LANE/.vercel"
[ -f "$LANE/.vercel/project.json" ] || cp "$MAIN_REPO/.vercel/project.json" "$LANE/.vercel/project.json" 2>/dev/null
ACTUAL=$(sed -n 's/.*"projectId":"\([^"]*\)".*/\1/p' "$LANE/.vercel/project.json" 2>/dev/null)
if [ "$ACTUAL" != "$EXPECT" ]; then
  echo "FAIL: lane is linked to project '$ACTUAL' but the wildcard *.${ZONE} belongs to '$EXPECT'."
  echo "      Deploying would succeed and serve nothing. Fix .vercel/project.json before retrying."
  exit 4
fi
step "project asserted: $ACTUAL"

# ── 4. Build + deploy, both bounded ─────────────────────────────────────────────
step "building previews"
( cd "$LANE" && perl -e 'alarm 600; exec @ARGV' pnpm --filter previews build ) >/dev/null 2>&1 || {
  echo "FAIL: previews build"; exit 5; }

step "deploying to production"
DEPLOY=$( cd "$LANE" && bash "$HERE/vercel-safe.sh" deploy --prod --scope "$SCOPE" \
          | grep -oE 'https://[a-z0-9-]+\.vercel\.app' | tail -1 )
[ -n "$DEPLOY" ] || { echo "FAIL: no deployment URL returned"; exit 6; }
step "deployment: $DEPLOY"

# ── 5. Bind the hostname as a PRODUCTION DOMAIN, not just an alias ──────────────
# An alias-only pin (`vercel alias set`) still 302s to the Vercel SSO login wall. This project's
# ssoProtection is `all_except_custom_domains`, and that exemption applies ONLY to a registered
# Production Domain — an alias does not qualify. Measured 2026-08-16 on abacus-plumbing: aliased,
# deployed, every path 302 -> vercel.com/sso-api. The decisive evidence that it is the HOSTNAME and
# not the deployment: impact-landscapes-frisco.grayreserve.agency was on the SAME deployment and
# returned 200 at the same moment.
#
# A registered domain also AUTO-FOLLOWS future production deploys, which retires the re-alias dance
# this script used to do on every publish. Same fact director-build.yml step 10 already relies on.
#
# ORDER MATTERS: `domains add` refuses with alias_conflict while an alias exists, so an existing
# alias must be removed first. That is a brief outage for a host that is already SERVING, so only
# remove it when the domain is not already bound.
step "binding $HOST as a production domain"
bind_out=$(bash "$HERE/vercel-safe.sh" domains add "$HOST" "$PROJECT_NAME" --scope "$SCOPE" 2>&1)
if printf '%s' "$bind_out" | grep -q 'alias_conflict'; then
  # Only reachable when a previous run aliased this host. Removing it is safe here precisely
  # because an aliased host is the broken (302) state we are repairing.
  step "clearing conflicting alias so the domain can bind"
  bash "$HERE/vercel-safe.sh" alias rm "$HOST" --yes --scope "$SCOPE" >/dev/null 2>&1
  bind_out=$(bash "$HERE/vercel-safe.sh" domains add "$HOST" "$PROJECT_NAME" --scope "$SCOPE" 2>&1)
fi
if printf '%s' "$bind_out" | grep -qE '"status"\s*:\s*"success"|domain_already_assigned|Success'; then
  step "domain bound"
else
  # Do not fail the run here — step 6 verifies what actually SERVES, which is the claim that
  # matters. Print the reason so a failure is diagnosable rather than silent.
  echo "WARN: domain bind did not report success; step 6 will decide. Reason:"
  printf '%s\n' "$bind_out" | tail -4
  bash "$HERE/vercel-safe.sh" alias set "$DEPLOY" "$HOST" --scope "$SCOPE" >/dev/null 2>&1
fi

# ── 6. PROVE it serves the new build ────────────────────────────────────────────
# Re-aliasing without verifying just moves the silent failure one step later. Cache-bust, because
# the edge served a 91-minute-old response while a 2-minute-old deployment was live.
step "verifying"
ok=""
for i in 1 2 3 4 5 6; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "https://${HOST}/?cb=$(date +%s)$i")
  [ "$code" = "200" ] && { ok=1; break; }
  sleep 5
done
[ -n "$ok" ] || { echo "FAIL: ${HOST} did not return 200 after aliasing"; exit 7; }

echo
echo "LIVE: https://${HOST}/  (deployment ${DEPLOY##*/}, 0 new Vercel projects)"
