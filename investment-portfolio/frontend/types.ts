export type AssetClass = "Stock" | "Bond" | "ETF" | "Cash" | "Crypto"
export type SortMode = "value" | "gain" | "weight" | "symbol"

export interface Holding {
  id: string
  symbol: string
  name: string
  assetClass: AssetClass
  shares: number
  price: number
  averageCost: number
  dayChangePercent: number
  notes: string
}

export interface PortfolioFilters {
  searchQuery: string
  assetClass: "All" | AssetClass
  sortMode: SortMode
}

export interface PortfolioSummary {
  totalValue: number
  cashBalance: number
  dayChangeValue: number
  totalGainValue: number
}

export interface Allocation {
  assetClass: AssetClass
  value: number
  weight: number
}
