import test from "node:test"
import { sourceText, assertMatch, assertNoMatch } from "./source-text"

const directorySources = ["app/page.tsx", "app/DirectoryPage.tsx", "app/DirectoryView.tsx"]

test("empty directory table shows the exact requested message", () => {
  const text = sourceText(directorySources)
  assertMatch(
    text,
    /No jobs found — try removing some filters\./,
    "expected the new empty-state copy",
  )
  assertNoMatch(
    text,
    /No postings match\. Try clearing filters, or run an ingest if the\s+database is empty/,
    "old empty-state copy should be gone",
  )
})

test("empty state still lives in the no-results table row", () => {
  const text = sourceText(directorySources)
  assertMatch(text, /filtered\.length\s*===\s*0[\s\S]{0,400}<td[^>]*colSpan=/, "expected no-results row")
})
