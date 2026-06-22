import test from "node:test"
import { sourceText, assertMatch } from "./source-text"

const directorySources = ["app/page.tsx", "app/DirectoryPage.tsx", "app/DirectoryView.tsx"]

test("role column renders role text with a bold treatment", () => {
  const text = sourceText(directorySources)
  assertMatch(text, /roleLines\.map/, "expected role lines to still be rendered")
  assertMatch(
    text,
    /roleLines\.map[\s\S]{0,500}(?:<strong\b|<b\b|fontWeight:\s*["']?(?:bold|[7-9]00)|className=["'][^"']*bold)/,
    "expected role line output to be bold",
  )
})

test("role column and row details still render apply and details links", () => {
  const text = sourceText(directorySources)
  assertMatch(text, /apply ↗/, "expected apply link text to remain")
  assertMatch(text, /details/, "expected details link text to remain")
})
