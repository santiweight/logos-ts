import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CommentPopup } from "./CommentPopup"

afterEach(cleanup)

describe("CommentPopup", () => {
  it("keeps an in-progress comment open when clicking outside and closes from the X button", () => {
    const onClose = vi.fn()
    const { container } = render(
      <CommentPopup
        x={120}
        y={80}
        label="FactTable"
        goals={[]}
        onAdd={vi.fn()}
        onClose={onClose}
      />
    )

    const textbox = screen.getByRole("textbox")
    fireEvent.change(textbox, {
      target: { value: "Do not discard this" },
    })
    fireEvent.click(container.firstElementChild as Element)

    expect(onClose).not.toHaveBeenCalled()
    expect(textbox).toHaveValue("Do not discard this")

    fireEvent.click(screen.getByTitle("Close"))

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
