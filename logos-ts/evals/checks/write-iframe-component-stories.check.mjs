// Eval oracle for Storybook stories around components that own a nested iframe.
// Copied into <workspace>/ at check time so the agent never sees this file.
import { readFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import { describe, it } from "node:test"
import assert from "node:assert/strict"

const storyFile = resolve(process.cwd(), "components/PreviewPanel.stories.tsx")
const componentFile = resolve(process.cwd(), "components/PreviewPanel.tsx")

function readStory() {
  assert.equal(existsSync(storyFile), true, "components/PreviewPanel.stories.tsx should exist")
  return readFileSync(storyFile, "utf8")
}

function readComponent() {
  assert.equal(existsSync(componentFile), true, "components/PreviewPanel.tsx should exist")
  return readFileSync(componentFile, "utf8")
}

describe("PreviewPanel iframe-boundary stories", () => {
  it("uses typed Storybook exports for the target component", () => {
    const text = readStory()
    assert.match(text, /\bMeta\b/)
    assert.match(text, /\bStoryObj\b/)
    assert.match(text, /component:\s*PreviewPanel/)
  })

  it("does not create live nested-iframe runtime dependencies", () => {
    const text = readStory()

    assert.doesNotMatch(text, /localhost:\d+/, "stories must not depend on a hard-coded local Storybook port")
    assert.doesNotMatch(text, /https?:\/\/[^"'`]+/, "stories must not depend on external iframe hosts")
    assert.doesNotMatch(text, /storybookUrl:\s*["'`][^"'`]+["'`]/, "stories must not set live storybookUrl values")
    assert.doesNotMatch(text, /renderer:\s*["'`]storybook["'`]/, "stories must not exercise live Storybook iframe mode")
  })

  it("documents or mocks the nested iframe boundary", () => {
    const text = readStory()
    const component = readComponent()
    const combined = `${component}\n${text}`

    assert.match(
      combined,
      /render(?:Story)?Frame|mock(?:Story)?Frame|iframeBoundary/i,
      "component/story should expose and use a small story-test seam for the iframe boundary",
    )
    assert.match(
      text,
      /mock|fixture|iframe boundary|nested iframe|app runtime|portable-story/i,
      "stories should explicitly document or mock the app-owned iframe boundary",
    )
  })
})
