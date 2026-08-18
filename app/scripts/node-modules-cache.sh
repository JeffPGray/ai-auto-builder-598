#!/bin/bash
# node-modules-cache.sh <target-dir>
#
# Populate <target-dir>/node_modules from a shared, APFS copy-on-write cache instead of running
# `npm install` from scratch on every single build.
#
# WHY THIS EXISTS (Fable's caching review, 2026-08-18): every build did
# `rm -rf node_modules; npm install` — a full fresh install per client, every time, with no reuse
# across clients and no reuse across dispatches for the SAME client. Measured: templates/trade-site
# installs to ~463 MB. At the project's own stated target of 50-100 builds/day that is 23-46 GB/day
# of disk churn and real install wall-clock, for a dependency set that is IDENTICAL across every
# client unless the template's package-lock.json itself changed.
#
# THE FIX: build the real node_modules ONCE into a shared cache dir, keyed by a hash of
# package-lock.json (so a template dependency bump invalidates the cache correctly, automatically —
# never manually). Every build then CLONES the cache via `cp -c` (APFS copy-on-write): the clone
# shares the underlying blocks with the cache until either side writes, so it costs ~2 seconds and
# near-zero incremental disk instead of a full install. `npm ci` (not `npm install`) builds the
# cache itself, because `npm install` can silently drift a lockfile; `npm ci` refuses to and is the
# correct command for "install exactly what the lockfile says," which is what a shared cache
# requires to stay trustworthy.
#
# On a non-APFS filesystem (verify with `diskutil info / | grep -i "file system"` on macOS, or
# `stat -f -c %T .` on Linux — btrfs/xfs also support reflink via `cp --reflink=auto`), `cp -c`
# fails and this script falls back to a plain recursive copy — slower (real bytes, not
# copy-on-write) but still avoids re-running npm install, which is the actual expensive part.
set -euo pipefail

TARGET_DIR="${1:?usage: node-modules-cache.sh <target-dir-containing-package-lock.json>}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE_ROOT="$REPO_ROOT/.node_modules_cache"

[ -f "$TARGET_DIR/package-lock.json" ] || { echo "no package-lock.json in $TARGET_DIR — nothing to cache against"; exit 1; }

LOCK_HASH=$(shasum -a 256 "$TARGET_DIR/package-lock.json" | cut -d' ' -f1 | cut -c1-16)
CACHE_DIR="$CACHE_ROOT/$LOCK_HASH"

if [ ! -d "$CACHE_DIR/node_modules" ]; then
  echo "node-modules-cache: no cache for lockfile hash $LOCK_HASH — building it once (npm ci)"
  mkdir -p "$CACHE_DIR"
  cp "$TARGET_DIR/package.json" "$TARGET_DIR/package-lock.json" "$CACHE_DIR/"
  ( cd "$CACHE_DIR" && npm ci )
  echo "node-modules-cache: cache built at $CACHE_DIR"
else
  echo "node-modules-cache: reusing existing cache for lockfile hash $LOCK_HASH"
fi

rm -rf "$TARGET_DIR/node_modules"
if cp -c -R "$CACHE_DIR/node_modules" "$TARGET_DIR/node_modules" 2>/dev/null; then
  echo "node-modules-cache: cloned via APFS copy-on-write (cp -c) — fast, near-zero incremental disk"
else
  echo "node-modules-cache: cp -c unavailable on this filesystem — falling back to a plain recursive copy"
  cp -R "$CACHE_DIR/node_modules" "$TARGET_DIR/node_modules"
fi
