import test from "node:test"
import { sourceText, assertMatch, assertNoMatch } from "./source-text"

const directorySources = ["app/page.tsx", "app/DirectoryPage.tsx", "app/DirectoryView.tsx"]

test("directory table header reads Employer, not Company", () => {
  const text = sourceText(directorySources)
  assertMatch(text, /<th>\s*Employer\s*<\/th>/, "expected an Employer column header")
  assertNoMatch(text, /<th>\s*Company\s*<\/th>/, "old Company column header should be renamed")
})

test("other directory headers remain present", () => {
  const text = sourceText(directorySources)
  for (const header of ["Role", "Location", "Salary", "Tech", "Apply", "Details"]) {
    assertMatch(text, new RegExp(`<th>\\s*${header}\\s*</th>`), `missing ${header} header`)
  }
})
