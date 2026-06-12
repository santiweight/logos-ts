import { describe, it, expect } from "vitest"

// The element-context and goal-line construction is embedded in WorkspaceManager.runGoalAgent
// and duplicated in evals/run.ts buildPrompt. We test the logic here to guard against
// regressions in prompt construction — especially the selector/storyId/component enrichment
// that tells the agent which DOM element the user clicked.

function buildElementContext(goal: { component?: string | null; storyId?: string | null; selector?: string | null }): string {
  return [
    goal.component && `component: ${goal.component}`,
    goal.storyId && `story: ${goal.storyId}`,
    goal.selector && `element: ${goal.selector}`,
  ].filter(Boolean).join(", ")
}

function buildGoalLine(goal: { label: string; text: string; component?: string | null; storyId?: string | null; selector?: string | null }): string {
  const elementContext = buildElementContext(goal)
  return `- (${goal.label}${elementContext ? ` [${elementContext}]` : ""}) ${goal.text}`
}

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
      storyId: undefined,
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

describe("processNext goal selection logic", () => {
  // The real processNext finds the first goal with status "pending" that isn't
  // already in runningAgents. We test the selection predicate in isolation.

  interface MinGoal {
    id: string
    status: "pending" | "running" | "done" | "error"
  }

  function selectNext(goals: MinGoal[], running: Set<string>): MinGoal | undefined {
    return goals.find((g) => g.status === "pending" && !running.has(g.id))
  }

  it("picks the first pending goal", () => {
    const goals: MinGoal[] = [
      { id: "g-1", status: "done" },
      { id: "g-2", status: "pending" },
      { id: "g-3", status: "pending" },
    ]
    expect(selectNext(goals, new Set())?.id).toBe("g-2")
  })

  it("skips goals already running", () => {
    const goals: MinGoal[] = [
      { id: "g-1", status: "pending" },
      { id: "g-2", status: "pending" },
    ]
    expect(selectNext(goals, new Set(["g-1"]))?.id).toBe("g-2")
  })

  it("returns undefined when all pending goals are running", () => {
    const goals: MinGoal[] = [
      { id: "g-1", status: "pending" },
      { id: "g-2", status: "done" },
    ]
    expect(selectNext(goals, new Set(["g-1"]))).toBeUndefined()
  })

  it("returns undefined when no pending goals exist", () => {
    const goals: MinGoal[] = [
      { id: "g-1", status: "done" },
      { id: "g-2", status: "error" },
    ]
    expect(selectNext(goals, new Set())).toBeUndefined()
  })

  it("allows concurrent goals — multiple pending goals can each be selected", () => {
    const goals: MinGoal[] = [
      { id: "g-1", status: "pending" },
      { id: "g-2", status: "pending" },
      { id: "g-3", status: "pending" },
    ]
    const running = new Set<string>()

    const first = selectNext(goals, running)!
    expect(first.id).toBe("g-1")
    running.add(first.id)

    const second = selectNext(goals, running)!
    expect(second.id).toBe("g-2")
    running.add(second.id)

    const third = selectNext(goals, running)!
    expect(third.id).toBe("g-3")
  })
})
