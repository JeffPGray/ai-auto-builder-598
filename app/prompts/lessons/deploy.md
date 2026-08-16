# Lessons — Deployment

Accumulated lessons for the deploy stage.

## Deployment
The `/deploy` skill is the source of truth and branches on `DEPLOY_PROVIDER` (Vercel, Cloudflare Pages, or Netlify). These lessons apply to all hosts.
- **Always reuse the same deploy project (the client slug).** When redeploying, target the exact same project name. Check Supabase for the existing deployed_url: `python3 scripts/db.py client SLUG`. Never create duplicate projects with suffixes.
- **If deployment fails (rate limit, quota, auth/403 error), STOP.** Do not fall back to the other host, GitHub Pages, or any other platform. Mark the client as "built" in Supabase and do NOT send outreach. Wait for the user to resolve the issue (on Cloudflare a 403 usually means the API token is missing the "Cloudflare Pages → Edit" permission). Sending outreach with a broken or non-standard URL wastes the lead.

---
*Add new lessons for this stage as they arise*
