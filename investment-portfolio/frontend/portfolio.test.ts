import { describe, expect, it } from "vitest"
import { holdings } from "./data/holdings"
import {
  allocationByAssetClass,
  filterHoldings,
  formatCurrency,
  formatPercent,
  holdingGainPercent,
  summarizePortfolio,
} from "./portfolio"

describe("portfolio helpers", () => {
  it("summarizes total value, cash, and gains", () => {
    const summary = summarizePortfolio(holdings)

    expect(summary.totalValue).toBeGreaterThan(0)
    expect(summary.cashBalance).toBe(6840)
    expect(summary.totalGainValue).toBeGreaterThan(0)
  })

  it("filters and sorts holdings for the table", () => {
    const result = filterHoldings(holdings, {
      searchQuery: "vanguard",
      assetClass: "All",
      sortMode: "symbol",
    })

    expect(result.map((holding) => holding.symbol)).toEqual(["BND", "VOO"])
  })

  it("builds allocation rows and display values", () => {
    const allocation = allocationByAssetClass(holdings)

    expect(allocation.map((item) => item.assetClass)).toContain("Stock")
    expect(holdingGainPercent(holdings[0]!)).toBeGreaterThan(0)
    expect(formatCurrency(125000)).toBe("$125,000")
    expect(formatPercent(-1.24)).toBe("-1.2%")
  })
})
