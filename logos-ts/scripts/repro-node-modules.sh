#!/usr/bin/env bash
#
# End-to-end repro for node_modules cache service.
#
# Tests the cache at the filesystem level (no tsx inline eval).
# Unit tests in node-modules-cache.test.ts cover the service API.
#
# Usage: bash scripts/repro-node-modules.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOGOS_TS="$(cd "$SCRIPT_DIR/.." && pwd)"
DEMOS_HN_JOBS="$LOGOS_TS/demos/hn-jobs"
CACHE_DIR="$HOME/.logos/nm-cache"

pass=0
fail=0
results=()

check() {
  local label="$1"
  local status="$2"
  local detail="${3:-}"
  if [ "$status" = "PASS" ]; then
    ((pass++)) || true
    results+=("  ✓ $label")
  else
    ((fail++)) || true
    results+=("  ✗ $label: $detail")
  fi
}

echo "=== node_modules cache: strategy comparison ==="
echo "hn-jobs: $DEMOS_HN_JOBS"
echo ""

# Ensure source has node_modules
if [ ! -d "$DEMOS_HN_JOBS/node_modules" ]; then
  echo "SETUP: installing deps in hn-jobs source..."
  (cd "$DEMOS_HN_JOBS" && npm install --silent 2>/dev/null)
fi

WORKDIR="$(mktemp -d /tmp/logos-nm-repro-XXXXXX)"
trap 'rm -rf "$WORKDIR"' EXIT

# ---------------------------------------------------------------------------
# Strategy 1: SYMLINK (what the cache service does)
# ---------------------------------------------------------------------------
echo "--- Strategy: SYMLINK (cache service approach) ---"
DEST="$WORKDIR/symlink"
mkdir -p "$DEST"
rsync -a --exclude node_modules --exclude .git --exclude dist "$DEMOS_HN_JOBS/" "$DEST/"
ln -s "$DEMOS_HN_JOBS/node_modules" "$DEST/node_modules"

if [ -L "$DEST/node_modules/.bin/prisma" ]; then
  check "symlink: .bin/prisma is symlink" "PASS"
else
  check "symlink: .bin/prisma is symlink" "FAIL" "not a symlink"
fi

if (cd "$DEST" && node_modules/.bin/prisma --version) >/dev/null 2>&1; then
  check "symlink: prisma runs" "PASS"
else
  err=$(cd "$DEST" && node_modules/.bin/prisma --version 2>&1 | grep -o 'ENOENT.*' | head -1)
  check "symlink: prisma runs" "FAIL" "${err:-prisma failed}"
fi

if (cd "$DEST" && npx next --version) >/dev/null 2>&1; then
  check "symlink: next.js accessible" "PASS"
else
  check "symlink: next.js accessible" "FAIL" "next not found"
fi

echo ""

# ---------------------------------------------------------------------------
# Strategy 2: APFS CLONE (broken — for comparison)
# ---------------------------------------------------------------------------
echo "--- Strategy: APFS CLONE (cp -rc, known broken) ---"
DEST2="$WORKDIR/apfs-clone"
mkdir -p "$DEST2"
rsync -a --exclude node_modules --exclude .git --exclude dist "$DEMOS_HN_JOBS/" "$DEST2/"
cp -rc "$DEMOS_HN_JOBS/node_modules" "$DEST2/node_modules"

if [ -L "$DEST2/node_modules/.bin/prisma" ]; then
  check "apfs-clone: .bin/prisma is symlink" "PASS"
else
  check "apfs-clone: .bin/prisma is symlink" "FAIL" "dereferenced (KNOWN BUG)"
fi

if (cd "$DEST2" && node_modules/.bin/prisma --version) >/dev/null 2>&1; then
  check "apfs-clone: prisma runs" "PASS"
else
  check "apfs-clone: prisma runs" "FAIL" "wasm ENOENT (KNOWN BUG)"
fi

echo ""

# ---------------------------------------------------------------------------
# Timing: symlink vs npm install (cache miss cost)
# ---------------------------------------------------------------------------
echo "--- Timing ---"
TIMING_DIR="$WORKDIR/timing"
mkdir -p "$TIMING_DIR"
rsync -a --exclude node_modules --exclude .git --exclude dist "$DEMOS_HN_JOBS/" "$TIMING_DIR/"

echo -n "  symlink:     "
SYMLINK_TIME=$( { time ln -s "$DEMOS_HN_JOBS/node_modules" "$WORKDIR/timing-symlink-nm" ; } 2>&1 | grep real | awk '{print $2}')
echo "$SYMLINK_TIME"

echo -n "  npm install: "
NPM_TIME=$( { time (cd "$TIMING_DIR" && npm install --silent 2>/dev/null) ; } 2>&1 | grep real | awk '{print $2}')
echo "$NPM_TIME (one-time cache miss cost)"

echo ""

# ---------------------------------------------------------------------------
# Cache entry verification
# ---------------------------------------------------------------------------
echo "--- Cache directory ---"
if [ -d "$CACHE_DIR" ]; then
  echo "  entries: $(ls "$CACHE_DIR" | wc -l | tr -d ' ')"
  for entry in "$CACHE_DIR"/*/; do
    [ -d "$entry" ] || continue
    name=$(basename "$entry")
    has_nm="no"
    has_bin="no"
    [ -d "$entry/node_modules" ] && has_nm="yes"
    [ -d "$entry/node_modules/.bin" ] && has_bin="yes"
    echo "  ${name:0:12}… nm=$has_nm bin=$has_bin"
  done
else
  echo "  (no cache yet — run studio to populate)"
fi

echo ""

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo "=== RESULTS ==="
for r in "${results[@]}"; do
  echo "$r"
done
echo ""
echo "passed: $pass  failed: $fail"
echo ""
echo "The cache service uses the symlink strategy (instant, .bin works)."
echo "APFS clone is shown for comparison — it breaks .bin symlinks."
echo "Cache miss cost (npm install) is paid once per unique lockfile."
