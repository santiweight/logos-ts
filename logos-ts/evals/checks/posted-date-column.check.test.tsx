import test from "node:test"
import { sourceText, assertMatch } from "./source-text"

const directorySources = ["app/page.tsx", "app/DirectoryPage.tsx", "app/DirectoryView.tsx"]

test("Posted is added as the last directory table header", () => {
  const text = sourceText(directorySources)
  assertMatch(
    text,
    /<th>\s*Details\s*<\/th>\s*<th>\s*Posted\s*<\/th>/,
    "expected Posted header immediately after Details",
  )
})

test("postedAt is rendered as an ISO date in the last data cell", () => {
  const text = sourceText(directorySources)
  assertMatch(
    text,
    /postedAt[\s\S]{0,160}(?:toISOString\(\)\.slice\(0,\s*10\)|formatPostedDate|formatIsoDate|formatDateOnly)/,
    "expected postedAt to be formatted as YYYY-MM-DD",
  )
  assertMatch(
    text,
    /<td[^>]*>[\s\S]{0,160}(?:postedDate|postedAt[\s\S]{0,120}(?:toISOString\(\)\.slice\(0,\s*10\)|formatPostedDate|formatIsoDate|formatDateOnly))[\s\S]{0,160}<\/td>\s*<\/tr>/,
    "expected posted date data cell at the end of the row",
  )
})
