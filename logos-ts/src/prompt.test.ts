import { describe, expect, it } from "vitest"
import {
  buildArchImplementationPrompt,
  buildArchPrompt,
  buildImplPrompt,
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
