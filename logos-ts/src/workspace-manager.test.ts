import { describe, it, expect } from "vitest"
import { buildElementContext, buildGoalLine, selectNextGoal } from "./prompt.js"

describe("element context prompt construction", () => {
  it("includes all three fields when present", () => {
    const line = buildGoalLine({
      label: "div · Senior Engineer",
      text: "Make this text bold",
      component: "JobTable",
      storyId: "components-jobtable--default",
      selector: ":scope > table > tbody > tr:nth-of-type(1) > td:nth-of-type(2)",
    })
    expect(line).toContain("component: JobTable")
    expect(line).toContain("story: components-jobtable--default")
    expect(line).toContain("element: :scope > table > tbody > tr:nth-of-type(1)")
    expect(line).toContain("Make this text bold")
    expect(line).toContain("div · Senior Engineer")
  })

  it("omits element context brackets when no fields are set", () => {
    const line = buildGoalLine({ label: "file.ts", text: "refactor this" })
    expect(line).toBe("- (file.ts) refactor this")
    expect(line).not.toContain("[")
  })

  it("handles partial fields (component only)", () => {
    const line = buildGoalLine({ label: "MyComp", text: "fix it", component: "MyComp" })
    expect(line).toBe("- (MyComp [component: MyComp]) fix it")
  })

  it("handles null/undefined fields without crashing", () => {
    const line = buildGoalLine({
      label: "div",
      text: "change color",
      component: null,
      storyId: null,
      selector: ":scope > div",
    })
    expect(line).toBe("- (div [element: :scope > div]) change color")
  })

  it("context string order is component, story, element", () => {
    const ctx = buildElementContext({
      component: "A",
      storyId: "b",
      selector: "c",
    })
    const parts = ctx.split(", ")
    expect(parts[0]).toMatch(/^component:/)
    expect(parts[1]).toMatch(/^story:/)
    expect(parts[2]).toMatch(/^element:/)
  })
})

describe("selectNextGoal", () => {
  interface MinGoal {
    id: string
    status: "pending" | "running" | "done" | "error"
  }

  it("picks the first pending goal", () => {
    const goals: MinGoal[] = [
      { id: "g-1", status: "done" },
      { id: "g-2", status: "pending" },
      { id: "g-3", status: "pending" },
    ]
    expect(selectNextGoal(goals, new Set())?.id).toBe("g-2")
  })

  it("skips goals already running", () => {
    const goals: MinGoal[] = [
      { id: "g-1", status: "pending" },
      { id: "g-2", status: "pending" },
    ]
    expect(selectNextGoal(goals, new Set(["g-1"]))?.id).toBe("g-2")
  })

  it("returns undefined when all pending goals are running", () => {
    const goals: MinGoal[] = [
      { id: "g-1", status: "pending" },
      { id: "g-2", status: "done" },
    ]
    expect(selectNextGoal(goals, new Set(["g-1"]))).toBeUndefined()
  })

  it("returns undefined when no pending goals exist", () => {
    const goals: MinGoal[] = [
      { id: "g-1", status: "done" },
      { id: "g-2", status: "error" },
    ]
    expect(selectNextGoal(goals, new Set())).toBeUndefined()
  })

  it("allows concurrent goals — multiple pending goals can each be selected", () => {
    const goals: MinGoal[] = [
      { id: "g-1", status: "pending" },
      { id: "g-2", status: "pending" },
      { id: "g-3", status: "pending" },
    ]
    const running = new Set<string>()

    const first = selectNextGoal(goals, running)!
    expect(first.id).toBe("g-1")
    running.add(first.id)

    const second = selectNextGoal(goals, running)!
    expect(second.id).toBe("g-2")
    running.add(second.id)

    const third = selectNextGoal(goals, running)!
    expect(third.id).toBe("g-3")
  })
})
