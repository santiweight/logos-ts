#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/logos-arch-types.XXXXXX")"
cleanup() {
  rm -rf "$TMP"
}
trap cleanup EXIT

assert_contains() {
  local file="$1"
  local needle="$2"
  if ! grep -Fq "$needle" "$file"; then
    echo "Expected $file to contain:" >&2
    echo "  $needle" >&2
    echo "--- $file ---" >&2
    cat "$file" >&2
    exit 1
  fi
}

assert_not_contains() {
  local file="$1"
  local needle="$2"
  if grep -Fq "$needle" "$file"; then
    echo "Expected $file not to contain:" >&2
    echo "  $needle" >&2
    echo "--- $file ---" >&2
    cat "$file" >&2
    exit 1
  fi
}

cat > "$TMP/taxonomy.ts" <<'TS'
export interface JobTaxonomy {
  needsReview: boolean
}

export function classifyJobTaxonomy(): JobTaxonomy {
  return { needsReview: false }
}
TS

cat > "$TMP/classify.ts" <<'TS'
import { classifyJobTaxonomy } from "./taxonomy"

export function classifyJobRow(job: { id: number }) {
  return classifyJobTaxonomy()
}
TS

INDEX_JSON="$TMP/index.json"
(cd "$ROOT" && pnpm exec tsx src/build-index.ts "$TMP" "$INDEX_JSON" >/dev/null)

assert_contains "$INDEX_JSON" 'classifyJobRow(job: { id: number }): import(\"./taxonomy\").JobTaxonomy'
assert_not_contains "$INDEX_JSON" 'import("/'
assert_not_contains "$INDEX_JSON" "$TMP"

REC_FILE="$TMP/.bodies.json"
(cd "$ROOT" && pnpm exec tsx src/archmode.ts strip "$TMP" "$REC_FILE" >/dev/null)

assert_contains "$TMP/classify.ts" 'export declare function classifyJobRow(job: { id: number }): import("./taxonomy").JobTaxonomy;'
assert_not_contains "$TMP/classify.ts" 'import("/'
assert_not_contains "$TMP/classify.ts" "$TMP"

(cd "$ROOT" && pnpm exec tsx src/archmode.ts splice "$TMP" "$REC_FILE" >/dev/null)

assert_contains "$TMP/classify.ts" 'export function classifyJobRow(job: { id: number }): import("./taxonomy").JobTaxonomy'
assert_contains "$TMP/classify.ts" 'return classifyJobTaxonomy()'
assert_not_contains "$TMP/classify.ts" 'import("/'
assert_not_contains "$TMP/classify.ts" "$TMP"

echo "arch type QA passed"
