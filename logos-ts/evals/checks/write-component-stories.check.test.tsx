import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"

function storyText(): string {
  return readFileSync(resolve(process.cwd(), "components/SearchableFilter.stories.tsx"), "utf8")
}

test("uses typed Storybook exports for the target component", () => {
  const text = storyText()
  assert.match(text, /Meta/)
  assert.match(text, /StoryObj/)
  assert.match(text, /component:\s*SearchableFilter/)
})

test("covers interactive filter states without production data", () => {
  const text = storyText()
  const storyExports = [...text.matchAll(/export const \w+\s*:/g)].map((match) => match[0])

  assert.ok(storyExports.length >= 4, "expected at least four story variants")
  assert.match(text, /items:\s*\[/, "expected deterministic item fixtures")
  assert.match(text, /searchable:\s*true/, "expected searchable state coverage")
  assert.match(text, /active:\s*true/, "expected active item state coverage")
  assert.match(text, /clearHref:/, "expected clear link state coverage")
  assert.match(text, /items:\s*\[\s*\]/, "expected empty item state coverage")
})
