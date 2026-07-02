import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CommentComposer, CommentThread, type CommentItem } from "./comment-ui"

afterEach(cleanup)

describe("CommentThread replies", () => {
  it("creates a change from a code comment", () => {
    const onAdd = vi.fn()
    render(
      <CommentThread
        label="FactTable"
        comments={[]}
        onAdd={onAdd}
        onClose={vi.fn()}
      />
    )

    fireEvent.change(screen.getByPlaceholderText("Reply…"), { target: { value: "make this bold" } })
    fireEvent.click(screen.getByText("Create Change"))

    expect(onAdd).toHaveBeenCalledWith({
      text: "make this bold",
      mode: "code",
    })
  })

  it("does not close the main comment composer on Escape", () => {
    const onClose = vi.fn()
    render(
      <CommentThread
        label="FactTable"
        comments={[]}
        onAdd={vi.fn()}
        onClose={onClose}
      />
    )

    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" })

    expect(onClose).not.toHaveBeenCalled()
  })

  it("does not cancel a new comment composer on Escape", () => {
    const onCancel = vi.fn()
    render(
      <CommentComposer
        label="FactTable"
        onSave={vi.fn()}
        onCancel={onCancel}
      />
    )

    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" })

    expect(onCancel).not.toHaveBeenCalled()
  })

  it("renders agent replies inline", () => {
    const comments: CommentItem[] = [
      {
        id: "goal-1",
        text: "make this bold",
        author: "you",
        createdAt: Date.now(),
        status: "done",
        sessionId: "sess-123",
        replies: [
          { author: "agent", text: "Changed FactTable.tsx — wrapped in <strong>.", createdAt: Date.now() },
        ],
      },
    ]

    render(
      <CommentThread
        label="FactTable"
        comments={comments}
        onAdd={vi.fn()}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByText("make this bold")).toBeTruthy()
    expect(screen.getByText("Changed FactTable.tsx — wrapped in <strong>.")).toBeTruthy()
    expect(screen.getByText("agent")).toBeTruthy()
  })

  it("renders multiple replies in order", () => {
    const comments: CommentItem[] = [
      {
        id: "goal-2",
        text: "original comment",
        createdAt: Date.now(),
        status: "done",
        sessionId: "sess-456",
        replies: [
          { author: "agent", text: "first agent reply", createdAt: 1000 },
          { author: "user", text: "follow up question", createdAt: 2000 },
          { author: "agent", text: "second agent reply", createdAt: 3000 },
        ],
      },
    ]

    render(
      <CommentThread
        label="Test"
        comments={comments}
        onAdd={vi.fn()}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByText("first agent reply")).toBeTruthy()
    expect(screen.getByText("follow up question")).toBeTruthy()
    expect(screen.getByText("second agent reply")).toBeTruthy()
  })

  it("renders no replies when replies array is empty", () => {
    const comments: CommentItem[] = [
      {
        id: "goal-3",
        text: "a comment",
        createdAt: Date.now(),
        status: "pending",
        replies: [],
      },
    ]

    render(
      <CommentThread
        label="Test"
        comments={comments}
        onAdd={vi.fn()}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByText("a comment")).toBeTruthy()
    expect(screen.queryByText("agent")).toBeNull()
  })

  it("renders replies when goal has no agentId but has replies field", () => {
    // This simulates how Goal objects are passed - they have sessionId/status, not agentId/agentStatus
    const goalAsComment = {
      id: "goal-4",
      text: "make it italic",
      label: "FactTable",
      target: "component:FactTable",
      mode: "code" as const,
      createdAt: Date.now(),
      status: "done" as const,
      sessionId: "sess-789",
      replies: [
        { author: "agent" as const, text: "Added italic styling.", createdAt: Date.now() },
      ],
    }

    render(
      <CommentThread
        label="FactTable"
        comments={[goalAsComment]}
        onAdd={vi.fn()}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByText("make it italic")).toBeTruthy()
    expect(screen.getByText("Added italic styling.")).toBeTruthy()
  })
})
