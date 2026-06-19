import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CommentSidebar } from "./CommentSidebar"
import type { Goal } from "./types"

afterEach(cleanup)

function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: "goal-1",
    label: "Make Postings Bold",
    text: "make this bold",
    target: "component:JobList",
    mode: "code",
    createdAt: 1000,
    status: "done",
    sessionId: "session-1",
    replies: [{ author: "agent", text: "Updated postings typography.", createdAt: 2000 }],
    ...overrides,
  }
}

function renderPanel({
  selectedGoal = goal(),
  running = false,
  onNavigate = vi.fn(),
  onReply = vi.fn(),
  onToggleAutoMerge = vi.fn(),
  onMerge = vi.fn(),
  onResizeStart = vi.fn(),
}: {
  selectedGoal?: Goal | null
  running?: boolean
  onNavigate?: (goal: Goal) => void
  onReply?: (goalId: string, text: string) => void
  onToggleAutoMerge?: (goalId: string, autoMerge: boolean) => void
  onMerge?: (goalId: string) => void
  onResizeStart?: () => void
} = {}) {
  render(
    <CommentSidebar
      goal={selectedGoal}
      running={running}
      onNavigate={onNavigate}
      onReply={onReply}
      onToggleAutoMerge={onToggleAutoMerge}
      onMerge={onMerge}
      onResizeStart={onResizeStart}
    />
  )
  return { onNavigate, onReply, onToggleAutoMerge, onMerge }
}

describe("CommentSidebar", () => {
  it("shows an empty state when no goal is selected", () => {
    renderPanel({ selectedGoal: null })

    expect(screen.getByText("Select a goal from a workspace.")).toBeInTheDocument()
  })

  it("renders exactly the selected goal thread", () => {
    renderPanel()

    expect(screen.getByText("Make Postings Bold")).toBeInTheDocument()
    expect(screen.getByText("make this bold")).toBeInTheDocument()
    expect(screen.getByText("Updated postings typography.")).toBeInTheDocument()
  })

  it("navigates to the selected goal target", () => {
    const onNavigate = vi.fn()
    const selectedGoal = goal()
    renderPanel({ selectedGoal, onNavigate })

    fireEvent.click(screen.getByText("Show target"))

    expect(onNavigate).toHaveBeenCalledWith(selectedGoal)
  })

  it("continues a completed goal thread", () => {
    const onReply = vi.fn()
    renderPanel({ onReply })

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Make the count bold too" } })
    fireEvent.click(screen.getByText("Send"))

    expect(onReply).toHaveBeenCalledWith("goal-1", "Make the count bold too")
  })

  it("does not allow replies before an agent session exists", () => {
    renderPanel({ selectedGoal: goal({ status: "pending", sessionId: null }) })

    expect(screen.getByRole("textbox")).toBeDisabled()
    expect(screen.getByText("Send")).toBeDisabled()
  })

  it("toggles auto merge from the thread header", () => {
    const onToggleAutoMerge = vi.fn()
    renderPanel({ onToggleAutoMerge })

    fireEvent.click(screen.getByTitle("Auto merge into the parent workspace"))

    expect(onToggleAutoMerge).toHaveBeenCalledWith("goal-1", false)
  })

  it("starts manual merge when implementation is ready", () => {
    const onMerge = vi.fn()
    renderPanel({
      onMerge,
      selectedGoal: goal({
        lifecycle: { stage: "impl", state: "ready_to_merge" },
        mergePolicy: { autoMerge: false },
      }),
    })

    fireEvent.click(screen.getByText("Merge"))

    expect(onMerge).toHaveBeenCalledWith("goal-1")
  })
})
