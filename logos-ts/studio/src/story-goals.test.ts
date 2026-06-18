import { describe, expect, it } from "vitest"
import { buildStoryWritingPrompt } from "./story-goals"

describe("buildStoryWritingPrompt", () => {
  it("asks for useful Storybook coverage without app-specific context", () => {
    const prompt = buildStoryWritingPrompt("ProfileCard")

    expect(prompt).toContain("Storybook stories")
    expect(prompt).toContain("ProfileCard")
    expect(prompt).toContain("normal/default state")
    expect(prompt).toContain("empty, loading, error, disabled")
    expect(prompt).toContain("domain-neutral")
    expect(prompt).toContain("typechecking")
    expect(prompt).not.toMatch(/hacker news|hn jobs|job postings|who is hiring/i)
  })
})
