import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CommentToolbar, Highlight, Pin, overlayStyle } from "./comment-overlay"

afterEach(cleanup)

describe("overlayStyle", () => {
  it("exports a CSS properties object with fixed positioning and high z-index", () => {
    expect(overlayStyle).toEqual(
      expect.objectContaining({
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: 2147483000,
      })
    )
  })

  it("includes monospace font family", () => {
    expect(overlayStyle.font).toContain("ui-monospace")
    expect(overlayStyle.font).toContain("12px")
  })
})

describe("Pin", () => {
  it("renders a button with the count as content", () => {
    const onClick = vi.fn()
    const rect = new DOMRect(100, 50, 200, 300)

    render(
      <Pin
        rect={rect}
        count={3}
        active={false}
        onClick={onClick}
      />
    )

    const button = screen.getByRole("button")
    expect(button).toHaveTextContent("3")
  })

  it("shows singular 'comment' in title when count is 1", () => {
    const rect = new DOMRect(100, 50, 200, 300)

    render(
      <Pin
        rect={rect}
        count={1}
        active={false}
        onClick={vi.fn()}
      />
    )

    expect(screen.getByTitle("1 comment")).toBeInTheDocument()
  })

  it("shows plural 'comments' in title when count is not 1", () => {
    const rect = new DOMRect(100, 50, 200, 300)

    render(
      <Pin
        rect={rect}
        count={5}
        active={false}
        onClick={vi.fn()}
      />
    )

    expect(screen.getByTitle("5 comments")).toBeInTheDocument()
  })

  it("calls onClick when clicked", () => {
    const onClick = vi.fn()
    const rect = new DOMRect(100, 50, 200, 300)

    render(
      <Pin
        rect={rect}
        count={2}
        active={false}
        onClick={onClick}
      />
    )

    const button = screen.getByRole("button")
    fireEvent.click(button)

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it("applies different styling when active is true", () => {
    const rect = new DOMRect(100, 50, 200, 300)

    const { rerender } = render(
      <Pin
        rect={rect}
        count={2}
        active={false}
        onClick={vi.fn()}
      />
    )

    const buttonInactive = screen.getByRole("button")
    const inactiveOutline = buttonInactive.style.outline

    rerender(
      <Pin
        rect={rect}
        count={2}
        active={true}
        onClick={vi.fn()}
      />
    )

    const buttonActive = screen.getByRole("button")
    const activeOutline = buttonActive.style.outline

    // Outline should be added when active
    expect(inactiveOutline).toBe("none")
    expect(activeOutline).toContain("2px solid")
  })

  it("positions the pin based on rect coordinates", () => {
    const rect = new DOMRect(100, 50, 200, 300)

    render(
      <Pin
        rect={rect}
        count={1}
        active={false}
        onClick={vi.fn()}
      />
    )

    const button = screen.getByRole("button")
    // rect.right - 9 = 300 - 9 = 291
    // rect.top - 9 = 50 - 9 = 41
    expect(button).toHaveStyle({
      left: "291px",
      top: "41px",
      position: "absolute",
    })
  })
})

describe("Highlight", () => {
  it("renders a div with the label text in a span", () => {
    const rect = new DOMRect(50, 100, 200, 150)

    render(
      <Highlight
        rect={rect}
        label="SearchInput"
      />
    )

    expect(screen.getByText("SearchInput")).toBeInTheDocument()
  })

  it("applies positioning from the rect", () => {
    const rect = new DOMRect(50, 100, 200, 150)

    render(
      <Highlight
        rect={rect}
        label="TestLabel"
      />
    )

    const highlightDiv = screen.getByText("TestLabel").closest("div")
    expect(highlightDiv).toHaveStyle({
      position: "absolute",
      left: "50px",
      top: "100px",
      width: "200px",
      height: "150px",
    })
  })

  it("renders with blue border and semi-transparent background", () => {
    const rect = new DOMRect(0, 0, 100, 100)

    render(
      <Highlight
        rect={rect}
        label="Element"
      />
    )

    const highlightDiv = screen.getByText("Element").closest("div")
    expect(highlightDiv).toHaveStyle({
      borderRadius: "4px",
      boxSizing: "border-box",
    })
  })

  it("positions label span above the highlight with absolute positioning", () => {
    const rect = new DOMRect(0, 0, 100, 100)

    render(
      <Highlight
        rect={rect}
        label="MyElement"
      />
    )

    const labelSpan = screen.getByText("MyElement")
    expect(labelSpan).toHaveStyle({
      position: "absolute",
      top: "-20px",
      left: "-2px",
      whiteSpace: "nowrap",
    })
  })
})

describe("CommentToolbar", () => {
  it("renders 'Comments' text when enabled is true", () => {
    render(
      <CommentToolbar
        enabled={true}
        onToggle={vi.fn()}
        total={0}
        altDown={false}
      />
    )

    expect(screen.getByText("Comments")).toBeInTheDocument()
  })

  it("renders 'Off' text when enabled is false", () => {
    render(
      <CommentToolbar
        enabled={false}
        onToggle={vi.fn()}
        total={0}
        altDown={false}
      />
    )

    expect(screen.getByText("Off")).toBeInTheDocument()
  })

  it("calls onToggle when the button is clicked", () => {
    const onToggle = vi.fn()

    render(
      <CommentToolbar
        enabled={true}
        onToggle={onToggle}
        total={0}
        altDown={false}
      />
    )

    const button = screen.getByRole("button")
    fireEvent.click(button)

    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it("does not show count pill when total is 0", () => {
    render(
      <CommentToolbar
        enabled={true}
        onToggle={vi.fn()}
        total={0}
        altDown={false}
      />
    )

    expect(screen.queryByText("0")).not.toBeInTheDocument()
  })

  it("shows count pill with the total when total > 0", () => {
    render(
      <CommentToolbar
        enabled={true}
        onToggle={vi.fn()}
        total={5}
        altDown={false}
      />
    )

    expect(screen.getByText("5")).toBeInTheDocument()
  })

  it("shows hint box with 'Alt + hover' when enabled and altDown is false", () => {
    render(
      <CommentToolbar
        enabled={true}
        onToggle={vi.fn()}
        total={0}
        altDown={false}
      />
    )

    expect(screen.getByText("Alt")).toBeInTheDocument()
    const hintSpan = screen.getByText("Alt").closest("span")
    expect(hintSpan).toHaveTextContent("hover")
  })

  it("shows hint box with 'Alt + click' when enabled and altDown is true", () => {
    render(
      <CommentToolbar
        enabled={true}
        onToggle={vi.fn()}
        total={0}
        altDown={true}
      />
    )

    expect(screen.getByText("Alt")).toBeInTheDocument()
    const hintSpan = screen.getByText("Alt").closest("span")
    expect(hintSpan).toHaveTextContent("click")
  })

  it("does not show hint box when disabled", () => {
    render(
      <CommentToolbar
        enabled={false}
        onToggle={vi.fn()}
        total={0}
        altDown={false}
      />
    )

    expect(screen.queryByText(/Alt/)).not.toBeInTheDocument()
  })

  it("shows both count pill and button text when enabled with comments", () => {
    render(
      <CommentToolbar
        enabled={true}
        onToggle={vi.fn()}
        total={3}
        altDown={false}
      />
    )

    expect(screen.getByText("3")).toBeInTheDocument()
    expect(screen.getByText("Comments")).toBeInTheDocument()
  })

  it("shows hint box with Alt key indicator", () => {
    render(
      <CommentToolbar
        enabled={true}
        onToggle={vi.fn()}
        total={0}
        altDown={false}
      />
    )

    const altKey = screen.getByText("Alt")
    expect(altKey).toBeInTheDocument()
    expect(altKey).toHaveStyle({
      background: "#2e2e34",
      borderRadius: "3px",
    })
  })
})
