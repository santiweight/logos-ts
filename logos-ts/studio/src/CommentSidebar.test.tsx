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
  stale = false,
  onReply = vi.fn(),
  onMerge = vi.fn(),
  onRebase = vi.fn(),
  onNewComment = vi.fn(),
  onClose = vi.fn(),
  onResizeStart = vi.fn(),
}: {
  selectedGoal?: Goal | null
  running?: boolean
  stale?: boolean
  onReply?: (goalId: string, text: string) => void
  onMerge?: (goalId: string) => void
  onRebase?: (goalId: string) => void
  onNewComment?: (text: string) => void
  onClose?: () => void
  onResizeStart?: () => void
} = {}) {
  render(
    <CommentSidebar
      goal={selectedGoal}
      running={running}
      stale={stale}
      onReply={onReply}
      onMerge={onMerge}
      onRebase={onRebase}
      onNewComment={onNewComment}
      onClose={onClose}
      onResizeStart={onResizeStart}
    />
  )
  return { onReply, onMerge, onRebase, onNewComment, onClose }
}

describe("CommentSidebar", () => {
  it("shows composer when no goal is selected", () => {
    renderPanel({ selectedGoal: null })

    expect(screen.getByPlaceholderText("Ask Claude anything...")).toBeInTheDocument()
  })

  it("creates a new workspace when posting from idle state", () => {
    const onNewComment = vi.fn()
    renderPanel({ selectedGoal: null, onNewComment })

    fireEvent.change(screen.getByPlaceholderText("Ask Claude anything..."), { target: { value: "Fix the login page" } })
    fireEvent.click(screen.getByText("Send"))

    expect(onNewComment).toHaveBeenCalledWith("Fix the login page")
  })

  it("renders exactly the selected goal thread", () => {
    renderPanel()

    expect(screen.getByText("Make Postings Bold")).toBeInTheDocument()
    expect(screen.getByText("make this bold")).toBeInTheDocument()
    expect(screen.getByText("Updated postings typography.")).toBeInTheDocument()
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

  it("accepts a change when implementation is ready", () => {
    const onMerge = vi.fn()
    renderPanel({
      onMerge,
      selectedGoal: goal({
        lifecycle: { stage: "impl", state: "ready_to_merge" },
        mergePolicy: { autoMerge: false },
      }),
    })

    fireEvent.click(screen.getByText("✓ Accept"))

    expect(onMerge).toHaveBeenCalledWith("goal-1")
  })

  it("shows Claude title in header", () => {
    renderPanel({ selectedGoal: null })

    expect(screen.getByText("Claude")).toBeInTheDocument()
  })

  it("does not fire onNewComment for empty/whitespace-only input", () => {
    const onNewComment = vi.fn()
    renderPanel({ selectedGoal: null, onNewComment })

    fireEvent.change(screen.getByPlaceholderText("Ask Claude anything..."), { target: { value: "   " } })
    fireEvent.click(screen.getByText("Send"))

    expect(onNewComment).not.toHaveBeenCalled()
  })

  it("clears composer after submitting new comment", () => {
    const onNewComment = vi.fn()
    renderPanel({ selectedGoal: null, onNewComment })

    const textarea = screen.getByPlaceholderText("Ask Claude anything...") as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: "Test comment" } })
    fireEvent.click(screen.getByText("Send"))

    expect(textarea.value).toBe("")
  })

  it("supports Cmd+Enter to submit new comment", () => {
    const onNewComment = vi.fn()
    renderPanel({ selectedGoal: null, onNewComment })

    const textarea = screen.getByPlaceholderText("Ask Claude anything...") as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: "Test with keyboard" } })
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true })

    expect(onNewComment).toHaveBeenCalledWith("Test with keyboard")
  })

  it("shows hint text in idle state", () => {
    renderPanel({ selectedGoal: null })

    expect(screen.getByText(/Select a workspace from the rail/)).toBeInTheDocument()
  })

  it("send button is disabled when composer is empty in idle state", () => {
    renderPanel({ selectedGoal: null })

    const sendButton = screen.getByText("Send") as HTMLButtonElement
    expect(sendButton).toBeDisabled()
  })

  it("switches from idle composer to goal thread when goal becomes non-null", () => {
    const { rerender } = render(
      <CommentSidebar
        goal={null}
        running={false}
        stale={false}
        onReply={vi.fn()}
        onMerge={vi.fn()}
        onRebase={vi.fn()}
        onNewComment={vi.fn()}
        onClose={vi.fn()}
        onResizeStart={vi.fn()}
      />
    )

    expect(screen.getByPlaceholderText("Ask Claude anything...")).toBeInTheDocument()

    rerender(
      <CommentSidebar
        goal={goal()}
        running={false}
        stale={false}
        onReply={vi.fn()}
        onMerge={vi.fn()}
        onRebase={vi.fn()}
        onNewComment={vi.fn()}
        onClose={vi.fn()}
        onResizeStart={vi.fn()}
      />
    )

    expect(screen.queryByPlaceholderText("Ask Claude anything...")).not.toBeInTheDocument()
    expect(screen.getByText("Make Postings Bold")).toBeInTheDocument()
  })

  it("closes the panel when Escape is pressed", () => {
    const onClose = vi.fn()
    renderPanel({ onClose })

    fireEvent.keyDown(window, { key: "Escape" })

    expect(onClose).toHaveBeenCalledOnce()
  })

  it("does not fire onClose on Escape when no goal is selected", () => {
    const onClose = vi.fn()
    renderPanel({ selectedGoal: null, onClose })

    fireEvent.keyDown(window, { key: "Escape" })

    expect(onClose).not.toHaveBeenCalled()
  })

  it("clears reply input when switching between goals", () => {
    const { rerender } = render(
      <CommentSidebar
        goal={goal()}
        running={false}
        stale={false}
        onReply={vi.fn()}
        onMerge={vi.fn()}
        onRebase={vi.fn()}
        onNewComment={vi.fn()}
        onClose={vi.fn()}
        onResizeStart={vi.fn()}
      />
    )

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: "Reply to goal 1" } })
    expect(textarea.value).toBe("Reply to goal 1")

    rerender(
      <CommentSidebar
        goal={goal({ id: "goal-2", label: "Different Goal", text: "different text" })}
        running={false}
        stale={false}
        onReply={vi.fn()}
        onMerge={vi.fn()}
        onRebase={vi.fn()}
        onNewComment={vi.fn()}
        onClose={vi.fn()}
        onResizeStart={vi.fn()}
      />
    )

    const newTextarea = screen.getByRole("textbox") as HTMLTextAreaElement
    expect(newTextarea.value).toBe("")
  })
})
