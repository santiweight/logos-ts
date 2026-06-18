import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CommentSidebar } from "./CommentSidebar"
import type { Goal, Selection } from "./types"

afterEach(cleanup)

function goal(overrides: Partial<Goal> & { target: string; text: string }): Goal {
  return {
    id: overrides.target,
    label: overrides.target,
    mode: "code",
    createdAt: 1000,
    status: "pending",
    ...overrides,
  }
}

function renderSidebar({
  goals,
  selection = { file: "src/math.ts", view: "code" },
  fileTargets = new Set(["file:src/math.ts"]),
  onNavigate = vi.fn(),
}: {
  goals: Goal[]
  selection?: Selection
  fileTargets?: ReadonlySet<string>
  onNavigate?: (goal: Goal) => void
}) {
  render(
    <CommentSidebar
      goals={goals}
      selection={selection}
      fileTargets={fileTargets}
      runningGoals={new Set()}
      onNavigate={onNavigate}
      onClose={() => {}}
    />
  )
  return { onNavigate }
}

describe("CommentSidebar", () => {
  it("includes function comments in the file-level comments list", () => {
    renderSidebar({
      goals: [
        goal({ target: "fn:add", text: "Check this function" }),
        goal({ target: "fn:otherFileFn", text: "Do not show this" }),
      ],
      fileTargets: new Set(["file:src/math.ts", "fn:add"]),
    })

    expect(screen.getByText("Check this function")).toBeTruthy()
    expect(screen.queryByText("Do not show this")).toBeNull()
    expect(screen.getByText("math.ts (1)")).toBeTruthy()
  })

  it("keeps component selection scoped to the selected component", () => {
    renderSidebar({
      goals: [
        goal({ target: "component:FactTable", text: "Component comment" }),
        goal({ target: "fn:add", text: "Function comment" }),
      ],
      selection: { file: "src/math.ts", component: "FactTable", view: "code" },
      fileTargets: new Set(["file:src/math.ts", "component:FactTable", "fn:add"]),
    })

    expect(screen.getByText("Component comment")).toBeTruthy()
    expect(screen.queryByText("Function comment")).toBeNull()
    expect(screen.getByText("FactTable (1)")).toBeTruthy()
  })

  it("navigates when a function comment card is clicked", () => {
    const onNavigate = vi.fn()
    const functionGoal = goal({ target: "fn:add", text: "Open add" })
    renderSidebar({
      goals: [functionGoal],
      fileTargets: new Set(["file:src/math.ts", "fn:add"]),
      onNavigate,
    })

    fireEvent.click(screen.getByText("Open add"))

    expect(onNavigate).toHaveBeenCalledWith(functionGoal)
  })
})
