#!/usr/bin/env bash
# QA: verify that every story produces a snapshot test automatically.
# Run from the logos-ts root:  bash scripts/qa-story-snapshots.sh [hn-jobs-root]
set -euo pipefail

ROOT="${1:-demos/hn-jobs}"
FRONTEND="$ROOT/frontend"
VITEST="$FRONTEND/node_modules/.bin/vitest"
SNAP="$FRONTEND/__snapshots__/stories.test.tsx.snap"
PASS=0
FAIL=0

step() { printf "\n\033[1m▸ %s\033[0m\n" "$1"; }
ok()   { PASS=$((PASS+1)); printf "  \033[32m✓\033[0m %s\n" "$1"; }
fail() { FAIL=$((FAIL+1)); printf "  \033[31m✗\033[0m %s\n" "$1"; }

# 1. stories.test.tsx exists
step "Glob test file exists"
if [[ -f "$FRONTEND/stories.test.tsx" ]]; then ok "frontend/stories.test.tsx"
else fail "frontend/stories.test.tsx missing"; fi

# 2. No old per-story captured test files remain
step "No legacy .captured.test.tsx files"
OLD=$(find "$ROOT" -name "*.captured.test.tsx" 2>/dev/null | head -5)
if [[ -z "$OLD" ]]; then ok "none found"
else fail "found: $OLD"; fi

# 3. Vitest runs and all story tests pass
step "Vitest runs all story tests"
if (cd "$ROOT" && "$VITEST" run frontend/stories.test.tsx --reporter=json --outputFile=/tmp/qa-stories.json \
    2>/dev/null); then
  TOTAL=$(node -e "const r=require('/tmp/qa-stories.json'); console.log(r.numTotalTests)")
  PASSED=$(node -e "const r=require('/tmp/qa-stories.json'); console.log(r.numPassedTests)")
  FAILED=$(node -e "const r=require('/tmp/qa-stories.json'); console.log(r.numFailedTests)")
  if [[ "$FAILED" == "0" ]]; then ok "$PASSED/$TOTAL tests passed"
  else fail "$FAILED/$TOTAL tests failed"; fi
else fail "vitest exited non-zero"; fi

# 4. Every *.stories.tsx has at least one snapshot key
step "Every story file has snapshots"
for sf in $(find "$FRONTEND" -name "*.stories.tsx" | sort); do
  REL="./${sf#$FRONTEND/}"
  if grep -q "captured: $REL" "$SNAP" 2>/dev/null; then
    ok "$REL"
  else
    fail "$REL — no snapshot keys found"
  fi
done

# 5. Build-index attaches snapshots to stories
step "Build-index produces snapshot-on-story (no captured field)"
INDEX=$(cd "$(dirname "$0")/.." && npx tsx src/build-index.ts "$ROOT" - 2>/dev/null)
HAS_CAPTURED=$(echo "$INDEX" | node -e "
  const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  const any=d.files.some(f=>(f.components||[]).some(c=>'captured' in c));
  console.log(any)
")
STORIES_WITH_SNAP=$(echo "$INDEX" | node -e "
  const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  const n=d.files.flatMap(f=>(f.components||[]).flatMap(c=>c.stories)).filter(s=>s.snapshot).length;
  console.log(n)
")
if [[ "$HAS_CAPTURED" == "false" ]]; then ok "no 'captured' field in index"
else fail "index still has 'captured' field"; fi
if [[ "$STORIES_WITH_SNAP" -gt 0 ]]; then ok "$STORIES_WITH_SNAP stories have snapshots"
else fail "no stories have snapshots"; fi

# 6. Full healthcheck still passes
step "Full healthcheck (all tests)"
HC=$(cd "$ROOT" && node scripts/healthcheck.mjs 2>&1)
HC_FAILED=$(echo "$HC" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(d.failed)")
HC_TOTAL=$(echo "$HC" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(d.total)")
if [[ "$HC_FAILED" == "0" ]]; then ok "$HC_TOTAL tests, 0 failures"
else fail "$HC_FAILED/$HC_TOTAL failed"; fi

# Summary
printf "\n\033[1m── QA Summary ──\033[0m\n"
printf "  passed: %d  failed: %d\n" "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]] && printf "  \033[32mAll checks passed.\033[0m\n" || printf "  \033[31mSome checks failed.\033[0m\n"
exit "$FAIL"
