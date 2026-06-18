import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { highlightTs, GotoCtx, CodeBlock, type SymbolMap } from "./highlight"
import type { SymbolLocation } from "./types"

afterEach(cleanup)

const symbols: SymbolMap = {
  Job: { file: "shared/types.ts", line: 96 },
  FilterItem: { file: "frontend/components/SearchableFilter.tsx", line: 4 },
  ParsedJob: { file: "shared/types.ts", line: 50 },
}

describe("highlightTs", () => {
  it("tokenizes keywords, types, and identifiers", () => {
    const nodes = highlightTs("function parseJob(text: string): ParsedJob")
    const { container } = render(<span>{nodes}</span>)
    expect(container.querySelector(".tok-keyword")?.textContent).toBe("function")
    expect(container.querySelector(".tok-function")?.textContent).toBe("parseJob")
    expect(container.querySelector(".tok-type")?.textContent).toBe("string")
    expect(container.querySelector(".tok-symbol")?.textContent).toBe("ParsedJob")
  })

  it("makes symbol-map types clickable", () => {
    const onGoto = vi.fn()
    const nodes = highlightTs("job: Job", symbols, onGoto)
    const { container } = render(<span>{nodes}</span>)

    const link = container.querySelector(".tok-link")
    expect(link).not.toBeNull()
    expect(link?.textContent).toBe("Job")
    expect(link?.getAttribute("title")).toBe("shared/types.ts:96")

    fireEvent.click(link!)
    expect(onGoto).toHaveBeenCalledWith({ file: "shared/types.ts", line: 96 }, "Job")
  })

  it("does not make unknown PascalCase tokens clickable", () => {
    const onGoto = vi.fn()
    const nodes = highlightTs("value: UnknownType", symbols, onGoto)
    const { container } = render(<span>{nodes}</span>)

    expect(container.querySelector(".tok-link")).toBeNull()
    expect(container.querySelector(".tok-symbol")?.textContent).toBe("UnknownType")
  })

  it("makes multiple types clickable in a signature", () => {
    const onGoto = vi.fn()
    const nodes = highlightTs("parseJob(text: string): ParsedJob", symbols, onGoto)
    const { container } = render(<span>{nodes}</span>)

    const links = container.querySelectorAll(".tok-link")
    expect(links).toHaveLength(1)
    expect(links[0]?.textContent).toBe("ParsedJob")
  })

  it("handles multiline prop field text", () => {
    const onGoto = vi.fn()
    const nodes = highlightTs("job: Job\nitems: FilterItem[]", symbols, onGoto)
    const { container } = render(<span>{nodes}</span>)

    const links = container.querySelectorAll(".tok-link")
    expect(links).toHaveLength(2)
    expect(links[0]?.textContent).toBe("Job")
    expect(links[1]?.textContent).toBe("FilterItem")
  })

  it("does not make keywords clickable even if in symbol map", () => {
    const syms: SymbolMap = { function: { file: "x.ts", line: 1 } }
    const onGoto = vi.fn()
    const nodes = highlightTs("function foo()", syms, onGoto)
    const { container } = render(<span>{nodes}</span>)

    expect(container.querySelector(".tok-link")).toBeNull()
  })
})

describe("CodeBlock", () => {
  it("renders highlighted code via GotoCtx", () => {
    const onGoto = vi.fn()
    const { container } = render(
      <GotoCtx.Provider value={{ symbols, onGoto }}>
        <CodeBlock code="const x: Job = getJob()" />
      </GotoCtx.Provider>
    )

    expect(container.querySelector(".tok-keyword")?.textContent).toBe("const")
    const link = container.querySelector(".tok-link")
    expect(link?.textContent).toBe("Job")

    fireEvent.click(link!)
    expect(onGoto).toHaveBeenCalledWith({ file: "shared/types.ts", line: 96 }, "Job")
  })

  it("renders without links when no symbols provided", () => {
    const { container } = render(<CodeBlock code="value: Job" />)

    expect(container.querySelector(".tok-link")).toBeNull()
    expect(container.querySelector(".tok-symbol")?.textContent).toBe("Job")
  })
})
