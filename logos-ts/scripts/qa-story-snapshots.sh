#!/usr/bin/env bash
# QA: verify that every indexed story has a generated browser snapshot.
# Run from the logos-ts root:  bash scripts/qa-story-snapshots.sh [hn-jobs-root]
set -euo pipefail

ROOT="${1:-demos/hn-jobs}"
LOGOS_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT_ROOT="$(cd "$ROOT" && pwd)"
VITEST="$LOGOS_ROOT/node_modules/.bin/vitest"
TSX="$LOGOS_ROOT/node_modules/.bin/tsx"
PASS=0
FAIL=0

step() { printf "\n\033[1m▸ %s\033[0m\n" "$1"; }
ok()   { PASS=$((PASS+1)); printf "  \033[32m✓\033[0m %s\n" "$1"; }
fail() { FAIL=$((FAIL+1)); printf "  \033[31m✗\033[0m %s\n" "$1"; }

# 1. Generated browser snapshot harness exists
step "Generated snapshot harness exists"
for file in \
  "$ROOT/.logos/story-snapshots.test.ts" \
  "$ROOT/.logos/story-snapshots.browser.tsx" \
  "$ROOT/.logos/story-snapshots.html" \
  "$ROOT/.logos/vitest.story-snapshots.config.ts"
do
  if [[ -f "$file" ]]; then ok "${file#$ROOT/}"
  else fail "${file#$ROOT/} missing"; fi
done

# 2. No old per-story captured test files remain
step "No legacy .captured.test.tsx files"
OLD=$(find "$ROOT" -name "*.captured.test.tsx" 2>/dev/null | head -5)
if [[ -z "$OLD" ]]; then ok "none found"
else fail "found: $OLD"; fi

# 3. Vitest runs and all generated browser story snapshots pass
step "Vitest runs generated story snapshots"
if (cd "$ROOT" && "$VITEST" run .logos/story-snapshots.test.ts --config .logos/vitest.story-snapshots.config.ts >/tmp/qa-stories.log); then
  TOTAL=$(node -e "const s=require('fs').readFileSync(process.argv[1],'utf8'); const m=s.match(/const stories = ([\\s\\S]*?) as /); console.log(m ? JSON.parse(m[1]).length : 0)" "$ROOT/.logos/story-snapshots.test.ts")
  ok "$TOTAL generated snapshot tests passed"
else
  fail "vitest exited non-zero; see /tmp/qa-stories.log"
fi

# 4. Build-index attaches snapshots to every indexed story
step "Build-index produces snapshot-on-story (no captured field)"
INDEX=$(cd "$(dirname "$0")/.." && "$TSX" src/build-index.ts "$ROOT" - 2>/dev/null)
HAS_CAPTURED=$(echo "$INDEX" | node -e "
  const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  const any=d.files.some(f=>(f.components||[]).some(c=>'captured' in c));
  console.log(any)
")
STORY_COUNTS=$(echo "$INDEX" | node -e "
  const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  const stories=d.files.flatMap(f=>(f.components||[]).flatMap(c=>c.stories));
  const missing=stories.filter(s=>!s.snapshot);
  console.log(JSON.stringify({total:stories.length, withSnapshots:stories.length-missing.length, missing:missing.map(s=>s.id)}))
")
if [[ "$HAS_CAPTURED" == "false" ]]; then ok "no 'captured' field in index"
else fail "index still has 'captured' field"; fi
TOTAL_STORIES=$(echo "$STORY_COUNTS" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(d.total)")
STORIES_WITH_SNAP=$(echo "$STORY_COUNTS" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(d.withSnapshots)")
MISSING_STORIES=$(echo "$STORY_COUNTS" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(d.missing.join(', '))")
if [[ "$TOTAL_STORIES" -gt 0 && "$STORIES_WITH_SNAP" == "$TOTAL_STORIES" ]]; then ok "$STORIES_WITH_SNAP/$TOTAL_STORIES stories have snapshots"
else fail "missing snapshots: ${MISSING_STORIES:-unknown}"; fi

# 5. Project tests still pass
step "Project tests"
if [[ -f "$ROOT/scripts/healthcheck.mjs" ]]; then
  if HC=$(cd "$ROOT" && node scripts/healthcheck.mjs 2>&1); then
    HC_FAILED=$(echo "$HC" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(d.failed)")
    HC_TOTAL=$(echo "$HC" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(d.total)")
    if [[ "$HC_FAILED" == "0" ]]; then ok "$HC_TOTAL tests, 0 failures"
    else fail "$HC_FAILED/$HC_TOTAL failed"; fi
  else
    fail "healthcheck exited non-zero"
  fi
elif (cd "$ROOT" && pnpm test >/tmp/qa-project-test.log); then
  ok "package test passed"
else
  fail "package test exited non-zero; see /tmp/qa-project-test.log"
fi

# Summary
printf "\n\033[1m── QA Summary ──\033[0m\n"
printf "  passed: %d  failed: %d\n" "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]] && printf "  \033[32mAll checks passed.\033[0m\n" || printf "  \033[31mSome checks failed.\033[0m\n"
exit "$FAIL"
