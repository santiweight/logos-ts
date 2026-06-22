import type { FC } from "react"
import type { AssetClass, PortfolioFilters, SortMode } from "../types"

interface PortfolioControlsProps {
  filters: PortfolioFilters
  assetClasses: Array<"All" | AssetClass>
  onFiltersChange?: (filters: PortfolioFilters) => void
}

const sortModes: Array<{ label: string; value: SortMode }> = [
  { label: "Value", value: "value" },
  { label: "Gain", value: "gain" },
  { label: "Weight", value: "weight" },
  { label: "Symbol", value: "symbol" },
]

export const PortfolioControls: FC<PortfolioControlsProps> = ({
  filters,
  assetClasses,
  onFiltersChange,
}) => {
  const update = (patch: Partial<PortfolioFilters>) => onFiltersChange?.({ ...filters, ...patch })

  return (
    <section className="portfolio-controls">
      <label className="search-control">
        <span>Search</span>
        <input
          type="search"
          value={filters.searchQuery}
          placeholder="Symbol, name, notes"
          onChange={(event) => update({ searchQuery: event.target.value })}
        />
      </label>
      <label>
        <span>Asset class</span>
        <select
          value={filters.assetClass}
          onChange={(event) => update({ assetClass: event.target.value as PortfolioFilters["assetClass"] })}
        >
          {assetClasses.map((assetClass) => <option key={assetClass}>{assetClass}</option>)}
        </select>
      </label>
      <fieldset>
        <legend>Sort</legend>
        {sortModes.map((mode) => (
          <button
            key={mode.value}
            className={filters.sortMode === mode.value ? "active" : ""}
            type="button"
            aria-pressed={filters.sortMode === mode.value}
            onClick={() => update({ sortMode: mode.value })}
          >
            {mode.label}
          </button>
        ))}
      </fieldset>
    </section>
  )
}
