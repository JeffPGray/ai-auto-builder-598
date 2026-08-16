#!/bin/bash
# Called after outreach with the client slug as argument.
# Reads client details from Supabase and sends an "outreach landed" summary
# to the operator via scripts/notify.sh (which routes to Telegram, email,
# or SMS per NOTIFY_CHANNEL in .env).
#
# Usage: ./scripts/outreach-notify-simple.sh business-slug
#
# If the notification channel isn't configured, notify.sh silently no-ops,
# so this script never fails the outreach pipeline.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

SLUG="${1:-}"
if [ -z "$SLUG" ]; then
  exit 0
fi

# Skip the Supabase round-trip below entirely when no notification channel
# is configured — the message would be built only to be dropped.
bash "$SCRIPT_DIR/notify.sh" --configured || exit 0

MSG=$(cd "$PROJECT_DIR" && python3 -c "
import sys; sys.path.insert(0, 'scripts')
from db import get_client_by_slug
c = get_client_by_slug('$SLUG')
if c:
    name = c.get('name', 'Unknown')
    location = c.get('location', 'Unknown')
    industry = c.get('industry', '')
    channel = (c.get('outreach_channel') or 'unknown').upper()
    url = c.get('deployed_url', 'N/A')
    msg = f'Outreach sent\nBusiness: {name}\nLocation: {location}\nIndustry: {industry}\nMethod: {channel}\nWebsite: {url}'
    print(msg)
" 2>/dev/null)

if [ -z "$MSG" ]; then
  exit 0
fi

bash "$SCRIPT_DIR/notify.sh" "📬 ${MSG}"
