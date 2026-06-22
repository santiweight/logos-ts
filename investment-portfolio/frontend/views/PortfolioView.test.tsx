import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"
import { holdings } from "../data/holdings"
import { PortfolioView } from "./PortfolioView"

afterEach(cleanup)

function dataRows() {
  return screen.getAllByRole("row").filter((row) => within(row).queryAllByRole("columnheader").length === 0)
}

describe("PortfolioView user stories", () => {
  it("renders a portfolio overview with default selection and summary context", () => {
    render(<PortfolioView />)

    expect(screen.getByRole("heading", { name: "Investment Portfolio" })).toBeTruthy()
    expect(screen.getByRole("region", { name: "Portfolio summary" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Allocation" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Holdings" })).toBeTruthy()

    const detail = screen.getByLabelText("Selected holding")
    expect(within(detail).getByRole("heading", { name: "VOO" })).toBeTruthy()
    expect(within(detail).getByText("Core US equity exposure.")).toBeTruthy()
  })

  it("searches by notes and shows a coherent empty state", async () => {
    const user = userEvent.setup()
    render(<PortfolioView />)

    await user.type(screen.getByRole("searchbox", { name: "Search" }), "dry powder")

    expect(screen.getByRole("row", { name: /CASH Settlement Fund Cash/ })).toBeTruthy()
    expect(screen.queryByRole("row", { name: /VOO Vanguard/ })).toBeNull()
    expect(within(screen.getByLabelText("Selected holding")).getByRole("heading", { name: "CASH" })).toBeTruthy()

    await user.clear(screen.getByRole("searchbox", { name: "Search" }))
    await user.type(screen.getByRole("searchbox", { name: "Search" }), "not a real holding")

    expect(screen.getByText("No holdings match these filters.")).toBeTruthy()
    expect(within(screen.getByLabelText("Selected holding")).getByText("No holding selected.")).toBeTruthy()
  })

  it("filters an asset sleeve, sorts it, and preserves selected detail", async () => {
    const user = userEvent.setup()
    render(<PortfolioView />)

    await user.selectOptions(screen.getByRole("combobox", { name: "Asset class" }), "Stock")
    await user.click(screen.getByRole("button", { name: "Symbol" }))

    expect(screen.getByRole("button", { name: "Symbol" }).getAttribute("aria-pressed")).toBe("true")
    expect(dataRows().map((row) => within(row).getAllByRole("cell")[0]?.textContent)).toEqual(["AAPL", "MSFT"])

    await user.click(screen.getByRole("row", { name: /MSFT Microsoft Corporation Stock/ }))

    const detail = screen.getByLabelText("Selected holding")
    expect(within(detail).getByRole("heading", { name: "MSFT" })).toBeTruthy()
    expect(within(detail).getByText("Large-cap software exposure.")).toBeTruthy()
  })

  it("supports keyboard selection from the holdings table", async () => {
    const user = userEvent.setup()
    render(<PortfolioView />)

    const appleRow = screen.getByRole("row", { name: /AAPL Apple Inc\. Stock/ })
    appleRow.focus()
    await user.keyboard("{Enter}")

    expect(appleRow.getAttribute("aria-selected")).toBe("true")
    expect(within(screen.getByLabelText("Selected holding")).getByRole("heading", { name: "AAPL" })).toBeTruthy()
  })

  it("handles an empty portfolio without stale details or divide-by-zero display", () => {
    render(<PortfolioView holdings={[]} />)

    expect(screen.getByText("No allocation data available.")).toBeTruthy()
    expect(screen.getByText("No holdings match these filters.")).toBeTruthy()
    expect(within(screen.getByLabelText("Selected holding")).getByText("No holding selected.")).toBeTruthy()
    expect(screen.getAllByText("$0").length).toBeGreaterThanOrEqual(4)
  })

  it("honors an initial filtered story state", () => {
    render(
      <PortfolioView
        holdings={holdings}
        initialFilters={{ searchQuery: "vanguard", assetClass: "All", sortMode: "symbol" }}
        selectedHoldingId="hold-003"
      />,
    )

    expect(screen.getByRole("searchbox", { name: "Search" }).getAttribute("value")).toBe("vanguard")
    expect(dataRows().map((row) => within(row).getAllByRole("cell")[0]?.textContent)).toEqual(["BND", "VOO"])
    expect(within(screen.getByLabelText("Selected holding")).getByRole("heading", { name: "BND" })).toBeTruthy()
  })

  it("restores the selected holding after temporary filters hide it", async () => {
    const user = userEvent.setup()
    render(<PortfolioView />)

    await user.click(screen.getByRole("row", { name: /MSFT Microsoft Corporation Stock/ }))
    await user.selectOptions(screen.getByRole("combobox", { name: "Asset class" }), "Cash")

    expect(within(screen.getByLabelText("Selected holding")).getByRole("heading", { name: "CASH" })).toBeTruthy()
    expect(screen.queryByRole("row", { name: /MSFT Microsoft Corporation Stock/ })).toBeNull()

    await user.selectOptions(screen.getByRole("combobox", { name: "Asset class" }), "All")

    expect(screen.getByRole("row", { name: /MSFT Microsoft Corporation Stock/ }).getAttribute("aria-selected")).toBe("true")
    expect(within(screen.getByLabelText("Selected holding")).getByRole("heading", { name: "MSFT" })).toBeTruthy()
  })

  it("normalizes invalid embedded filter and selected-holding state", () => {
    render(
      <PortfolioView
        holdings={holdings}
        initialFilters={{ searchQuery: "", assetClass: "Private Equity" as never, sortMode: "value" }}
        selectedHoldingId="missing-holding"
      />,
    )

    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Asset class" }).value).toBe("All")
    expect(dataRows()).toHaveLength(6)
    expect(within(screen.getByLabelText("Selected holding")).getByRole("heading", { name: "BTC" })).toBeTruthy()
  })
})
