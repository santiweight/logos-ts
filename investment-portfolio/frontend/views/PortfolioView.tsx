import { useMemo, useState, type FC } from "react"
import { holdings as defaultHoldings } from "../data/holdings"
import { AllocationBars } from "../components/AllocationBars"
import { HoldingDetail } from "../components/HoldingDetail"
import { HoldingsTable } from "../components/HoldingsTable"
import { PortfolioControls } from "../components/PortfolioControls"
import { SummaryCards } from "../components/SummaryCards"
import {
  allocationByAssetClass,
  filterHoldings,
  summarizePortfolio,
} from "../portfolio"
import type { AssetClass, Holding, PortfolioFilters } from "../types"

interface PortfolioViewProps {
  holdings?: Holding[]
  initialFilters?: PortfolioFilters
  selectedHoldingId?: string
}

const fallbackFilters: PortfolioFilters = {
  searchQuery: "",
  assetClass: "All",
  sortMode: "value",
}

function normalizeAssetClass(value: PortfolioFilters["assetClass"], options: Array<"All" | AssetClass>) {
  return options.includes(value) ? value : "All"
}

export const PortfolioView: FC<PortfolioViewProps> = ({
  holdings = defaultHoldings,
  initialFilters = fallbackFilters,
  selectedHoldingId,
}) => {
  const [filters, setFilters] = useState(initialFilters)
  const [selectedId, setSelectedId] = useState(selectedHoldingId ?? holdings[0]?.id ?? "")
  const summary = summarizePortfolio(holdings)
  const assetClasses = useMemo<Array<"All" | AssetClass>>(() => {
    return ["All", ...Array.from(new Set(holdings.map((holding) => holding.assetClass))).sort()]
  }, [holdings])
  const activeFilters = useMemo<PortfolioFilters>(() => ({
    ...filters,
    assetClass: normalizeAssetClass(filters.assetClass, assetClasses),
  }), [assetClasses, filters])
  const visibleHoldings = useMemo(() => filterHoldings(holdings, activeFilters), [holdings, activeFilters])
  const selectedHolding = visibleHoldings.find((holding) => holding.id === selectedId) ?? visibleHoldings[0]

  return (
    <main className="portfolio-shell">
      <header className="portfolio-header">
        <div>
          <p className="eyebrow">Demo portfolio</p>
          <h1>Investment Portfolio</h1>
        </div>
        <SummaryCards summary={summary} />
      </header>

      <PortfolioControls
        filters={activeFilters}
        assetClasses={assetClasses}
        onFiltersChange={setFilters}
      />

      <section className="portfolio-layout">
        <div className="portfolio-main">
          <AllocationBars allocations={allocationByAssetClass(holdings)} />
          <HoldingsTable
            holdings={visibleHoldings}
            totalValue={summary.totalValue}
            selectedHoldingId={selectedHolding?.id}
            onHoldingSelect={setSelectedId}
          />
        </div>
        <HoldingDetail holding={selectedHolding} />
      </section>
    </main>
  )
}
