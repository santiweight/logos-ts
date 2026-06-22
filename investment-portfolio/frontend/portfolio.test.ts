import { describe, expect, it } from "vitest"
import { holdings } from "./data/holdings"
import {
  allocationByAssetClass,
  filterHoldings,
  formatCurrency,
  formatPercent,
  holdingGainPercent,
  holdingWeight,
  summarizePortfolio,
} from "./portfolio"
import type { Holding } from "./types"

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

  it("filters case-insensitively across ticker, name, class, and notes", () => {
    expect(filterHoldings(holdings, {
      searchQuery: "  LARGE-CAP  ",
      assetClass: "Stock",
      sortMode: "symbol",
    }).map((holding) => holding.symbol)).toEqual(["MSFT"])

    expect(filterHoldings(holdings, {
      searchQuery: "crypto",
      assetClass: "All",
      sortMode: "value",
    }).map((holding) => holding.symbol)).toEqual(["BTC"])
  })

  it("handles zero-cost and zero-value edge cases", () => {
    const freeHolding: Holding = {
      id: "free",
      symbol: "FREE",
      name: "Free grant",
      assetClass: "Stock",
      shares: 10,
      price: 12,
      averageCost: 0,
      dayChangePercent: 0,
      notes: "Zero basis position.",
    }

    expect(holdingGainPercent(freeHolding)).toBe(0)
    expect(holdingWeight(freeHolding, 0)).toBe(0)
    expect(allocationByAssetClass([])).toEqual([])
    expect(summarizePortfolio([])).toEqual({
      totalValue: 0,
      cashBalance: 0,
      dayChangeValue: 0,
      totalGainValue: 0,
    })
  })

  it("builds allocation rows and display values", () => {
    const allocation = allocationByAssetClass(holdings)

    expect(allocation.map((item) => item.assetClass)).toContain("Stock")
    expect(holdingGainPercent(holdings[0]!)).toBeGreaterThan(0)
    expect(formatCurrency(125000)).toBe("$125,000")
    expect(formatPercent(-1.24)).toBe("-1.2%")
  })
})
