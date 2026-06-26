import { describe, expect, it } from "vitest"
import {
  buildArchImplementationPrompt,
  buildArchPrompt,
  buildImplPrompt,
  isWebResearchRequest,
} from "./prompt.js"

describe("architecture prompt testing guidance", () => {
  it("asks architecture agents for concrete behavioral specs and unit-level tests", () => {
    const prompt = buildArchPrompt("context", "sandbox", "- (Improve Flow) make the workflow clearer")

    expect(prompt).toContain("what should work and what should not work")
    expect(prompt).toContain("unit-level tests")
    expect(prompt).toContain("flow-level tests")
    expect(prompt).toContain("explicit non-goals")
  })

  it("does not inject domain-specific matching guidance into neutral prompts", () => {
    const prompts = [
      buildArchPrompt("context", "sandbox", "- (Improve Flow) make the workflow clearer"),
      buildImplPrompt("context", "sandbox", "- (Improve Flow) make the workflow clearer", "verify"),
      buildArchImplementationPrompt("context", "sandbox", "- (Improve Flow) make the workflow clearer", "verify"),
    ].join("\n")

    expect(prompts).not.toMatch(/\bfuzzy\b/i)
    expect(prompts).not.toMatch(/\bfuzzyScore\b/)
    expect(prompts).not.toMatch(/\bsearch\b/i)
    expect(prompts).not.toMatch(/\bsubstring\b/i)
    expect(prompts).not.toMatch(/\btypo-tolerant\b/i)
  })
})

describe("web research request detection", () => {
  it("matches requests that need online research tools", () => {
    expect(isWebResearchRequest("do research online before choosing a package")).toBe(true)
    expect(isWebResearchRequest("browse the web for current docs")).toBe(true)
    expect(isWebResearchRequest("look up the library API")).toBe(true)
  })

  it("does not match ordinary local code changes", () => {
    expect(isWebResearchRequest("add search to the directory page")).toBe(false)
    expect(isWebResearchRequest("fix the current component layout")).toBe(false)
  })
})
