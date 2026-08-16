#!/usr/bin/env bash
# Snapshot the VENDOR source exactly as `klaudius init` delivered it, BEFORE any local edit.
#
# WHY THIS EXISTS: the licence permits commercial use but forbids redistributing the source, and
# `npx klaudius@latest update` overwrites vendor files in place. Without a pristine copy taken
# before the first edit there is no way to answer the two questions that matter later:
#   1. did WE break this, or did an update?
#   2. what exactly did an update change underneath our modifications?
# A git diff against pristine/ answers both in seconds. Reconstructing it afterwards is impossible.
#
# Run ONCE, immediately after `klaudius init` completes and before touching anything.
#   ./scripts/snapshot-pristine.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# Klaudius refuses to scaffold into a non-empty folder, so the vendor source lives in app/ and our
# own repo files (CLAUDE.md, ledger, scripts, baseline) stay at the root. Snapshot the vendor tree.
SRC="${1:-$ROOT/app}"
DEST="$ROOT/pristine"

if [ ! -d "$SRC" ]; then
  echo "no vendor source at $SRC — run 'npx klaudius@latest init app' from the repo root first." >&2
  exit 1
fi

# A folder holding only .env/.mcp.json/.claude/settings.json is a HALF-FINISHED init: the wizard
# writes config as it goes but delivers scripts/ and the skills only after the credential checks
# pass. Snapshotting that state produces an empty "pristine baseline" that then blocks the real
# one (this script refuses to overwrite), which is worse than having no snapshot at all. It
# happened twice on 2026-08-15. Require real vendor payload before capturing.
if [ ! -d "$SRC/scripts" ] && [ ! -d "$SRC/.claude/skills" ]; then
  echo "REFUSING: $SRC has no scripts/ and no .claude/skills/ — the source has not been delivered." >&2
  echo "The wizard writes .env as it goes but ships the pipeline only after its credential checks" >&2
  echo "pass. Finish init (skipping email is fine), then re-run this." >&2
  exit 1
fi

if [ -d "$DEST" ]; then
  echo "pristine/ already exists — refusing to overwrite the only untouched copy." >&2
  echo "If you genuinely need a fresh baseline, move the old one aside first." >&2
  exit 1
fi

mkdir -p "$DEST"
# Copy the vendor payload only. node_modules/.venv are reinstallable and would bloat the diff;
# .env and .git are excluded because secrets must never enter a snapshot that may be committed.
for p in scripts .claude template templates supabase package.json pyproject.toml requirements.txt CLAUDE.md README.md; do
  [ -e "$SRC/$p" ] && cp -R "$SRC/$p" "$DEST/" 2>/dev/null || true
done

# Record exactly what was captured, so a later reader knows the baseline's provenance.
{
  echo "# Pristine vendor snapshot"
  echo
  echo "Captured: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "CLI version at capture: $(npx --yes klaudius@latest --version 2>/dev/null || echo 'unknown')"
  echo
  echo "This is the vendor source as \`klaudius init\` delivered it, before any local modification."
  echo "Never edit anything in this directory. Diff against it:"
  echo
  echo '    diff -ru pristine/scripts working/scripts'
  echo
  echo "## Captured paths"
  (cd "$DEST" && find . -maxdepth 2 -not -path './.git*' | sort | sed 's/^/  /')
} > "$DEST/PROVENANCE.md"

echo "pristine snapshot written to $DEST"
echo "next: cp -R the same paths into working/ and edit ONLY there"
