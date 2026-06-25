import { describe, expect, it } from "vitest"
import { buildStoryWritingPrompt } from "./story-goals"

describe("buildStoryWritingPrompt", () => {
  it("keeps the user-facing Storybook request short", () => {
    const prompt = buildStoryWritingPrompt("ProfileCard")

    expect(prompt).toBe("Generate Storybook stories for `ProfileCard`.")
    expect(prompt).not.toContain("normal/default state")
    expect(prompt).not.toContain("empty, loading, error, disabled")
    expect(prompt).not.toContain("domain-neutral")
    expect(prompt).not.toContain("typechecking")
    expect(prompt).not.toMatch(/hacker news|hn jobs|job postings|who is hiring/i)
  })
})
