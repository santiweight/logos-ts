import { cleanup, render, screen, fireEvent } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const scrollMock = vi.fn()
beforeEach(() => {
  Element.prototype.scrollIntoView = scrollMock
  scrollMock.mockClear()
})
import { Row } from "./arch"
import { GotoCtx, type SymbolMap } from "./highlight"
import type { SymbolLocation } from "./types"

afterEach(cleanup)

const symbols: SymbolMap = {
  Job: { file: "shared/types.ts", line: 96 },
}

function renderRow(props: Partial<Parameters<typeof Row>[0]> = {}, onGoto = vi.fn()) {
  return render(
    <GotoCtx.Provider value={{ symbols, onGoto }}>
      <Row
        tag="type"
        tagClass="type"
        title="interface Job"
        code="interface Job { id: string }"
        target="type:Job"
        label="T Job"
        {...props}
      />
    </GotoCtx.Provider>
  )
}

describe("Row", () => {
  it("starts collapsed by default", () => {
    renderRow()
    expect(screen.queryByText("interface Job { id: string }")).toBeNull()
  })

  it("expands on click", () => {
    const { container } = renderRow()
    fireEvent.click(screen.getByText("▸"))
    expect(container.querySelector(".code")).not.toBeNull()
  })

  it("starts expanded when initialOpen is true", () => {
    const { container } = renderRow({ initialOpen: true })
    expect(container.querySelector(".code")).not.toBeNull()
  })

  it("highlights types in the title as clickable links", () => {
    const onGoto = vi.fn()
    const { container } = renderRow({ title: "parseJob(): Job" }, onGoto)
    const link = container.querySelector(".tok-link")
    expect(link?.textContent).toBe("Job")

    fireEvent.click(link!)
    expect(onGoto).toHaveBeenCalledWith({ file: "shared/types.ts", line: 96 }, "Job")
  })

  it("highlights types in desc as clickable links", () => {
    const onGoto = vi.fn()
    const { container } = renderRow({ desc: "job: Job" }, onGoto)
    fireEvent.click(screen.getByText("▸"))
    const link = container.querySelector(".row-desc .tok-link")
    expect(link?.textContent).toBe("Job")

    fireEvent.click(link!)
    expect(onGoto).toHaveBeenCalledWith({ file: "shared/types.ts", line: 96 }, "Job")
  })

  it("scrolls into view when initialOpen is true", () => {
    renderRow({ initialOpen: true })
    expect(scrollMock).toHaveBeenCalledWith({ behavior: "smooth", block: "nearest" })
  })
})
