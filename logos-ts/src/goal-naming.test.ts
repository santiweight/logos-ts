import { describe, expect, it } from "vitest"
import { buildGoalNamePrompt, cleanGoalName, fallbackGoalName } from "./goal-naming.js"

describe("goal naming", () => {
  it("builds a constrained Haiku prompt from the comment and target context", () => {
    const prompt = buildGoalNamePrompt({
      text: "The filter sidebar is too noisy; collapse advanced filters by default.",
      label: "FilterSidebar",
      target: "component:FilterSidebar",
      component: "SearchFilters",
      selector: ":scope > aside",
      htmlContext: "selected: <aside>Advanced filters Sort by date</aside>",
      mode: "code",
    })

    expect(prompt).toContain("Name this coding-agent chat.")
    expect(prompt).toContain("2 to 5 words.")
    expect(prompt).toContain("48 characters maximum.")
    expect(prompt).toContain("Mode: code")
    expect(prompt).toContain("Component: SearchFilters")
    expect(prompt).toContain("Target: component:FilterSidebar")
    expect(prompt).toContain("Selected HTML context:")
    expect(prompt).toContain("selected: <aside>Advanced filters Sort by date</aside>")
    expect(prompt).toContain("Title: Make Postings Bold")
    expect(prompt).toContain("collapse advanced filters by default")
  })

  it("cleans common model response wrappers", () => {
    expect(cleanGoalName("\"Collapse Advanced Filters.\"\n")).toBe("Collapse Advanced Filters")
    expect(cleanGoalName("Title: Fix Workspace Navigation")).toBe("Fix Workspace Navigation")
  })

  it("falls back to a short title from the user comment", () => {
    expect(fallbackGoalName({
      text: "I want the workspace goal cards to stop showing enormous confusing names",
    })).toBe("Workspace Goal Cards Stop Showing")
  })

  it("uses selected HTML context for vague fallback titles", () => {
    expect(fallbackGoalName({
      text: "make this bold",
      label: "span \"postings\"",
      htmlContext: "selected: <span>postings</span>",
    })).toBe("Make Postings Bold")
  })

  it("truncates long fallback names", () => {
    const title = fallbackGoalName({
      text: "Implement extraordinarily verbose confusing generated workspace labels",
    })

    expect(title.length).toBeLessThanOrEqual(48)
  })
})
