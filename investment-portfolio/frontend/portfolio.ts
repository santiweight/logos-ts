import type { Allocation, AssetClass, Holding, PortfolioFilters, PortfolioSummary } from "./types"

const assetClassOrder: AssetClass[] = ["Stock", "ETF", "Bond", "Cash", "Crypto"]

export function holdingValue(holding: Holding): number {
  return holding.shares * holding.price
}

export function holdingCost(holding: Holding): number {
  return holding.shares * holding.averageCost
}

export function holdingGainValue(holding: Holding): number {
  return holdingValue(holding) - holdingCost(holding)
}

export function holdingGainPercent(holding: Holding): number {
  const cost = holdingCost(holding)
  if (cost === 0) return 0
  return (holdingGainValue(holding) / cost) * 100
}

export function summarizePortfolio(holdings: Holding[]): PortfolioSummary {
  return holdings.reduce<PortfolioSummary>(
    (summary, holding) => {
      const value = holdingValue(holding)
      return {
        totalValue: summary.totalValue + value,
        cashBalance: summary.cashBalance + (holding.assetClass === "Cash" ? value : 0),
        dayChangeValue: summary.dayChangeValue + value * (holding.dayChangePercent / 100),
        totalGainValue: summary.totalGainValue + holdingGainValue(holding),
      }
    },
    { totalValue: 0, cashBalance: 0, dayChangeValue: 0, totalGainValue: 0 },
  )
}

export function allocationByAssetClass(holdings: Holding[]): Allocation[] {
  const totalValue = summarizePortfolio(holdings).totalValue
  return assetClassOrder
    .map((assetClass) => {
      const value = holdings
        .filter((holding) => holding.assetClass === assetClass)
        .reduce((sum, holding) => sum + holdingValue(holding), 0)
      return { assetClass, value, weight: totalValue === 0 ? 0 : (value / totalValue) * 100 }
    })
    .filter((allocation) => allocation.value > 0)
}

export function filterHoldings(holdings: Holding[], filters: PortfolioFilters): Holding[] {
  const query = filters.searchQuery.trim().toLowerCase()
  const totalValue = summarizePortfolio(holdings).totalValue

  return holdings
    .filter((holding) => {
      const searchable = `${holding.symbol} ${holding.name} ${holding.assetClass} ${holding.notes}`.toLowerCase()
      const matchesQuery = query === "" || searchable.includes(query)
      const matchesClass = filters.assetClass === "All" || holding.assetClass === filters.assetClass
      return matchesQuery && matchesClass
    })
    .sort((a, b) => {
      if (filters.sortMode === "symbol") return a.symbol.localeCompare(b.symbol)
      if (filters.sortMode === "gain") return holdingGainPercent(b) - holdingGainPercent(a)
      if (filters.sortMode === "weight") return holdingWeight(b, totalValue) - holdingWeight(a, totalValue)
      return holdingValue(b) - holdingValue(a)
    })
}

export function holdingWeight(holding: Holding, totalValue: number): number {
  if (totalValue === 0) return 0
  return (holdingValue(holding) / totalValue) * 100
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value)
}

export function formatPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`
}
