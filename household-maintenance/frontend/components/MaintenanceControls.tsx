import type { FC } from "react"
import type { MaintenanceFilters, SortMode, TaskStatus } from "../types"

interface MaintenanceControlsProps {
  filters: MaintenanceFilters
  zones: string[]
  onFiltersChange?: (filters: MaintenanceFilters) => void
}

const statuses: Array<"All" | TaskStatus> = ["All", "Overdue", "Due Soon", "Scheduled", "Watching"]

const sortModes: Array<{ label: string; value: SortMode }> = [
  { label: "Due date", value: "due" },
  { label: "Priority", value: "priority" },
  { label: "Asset", value: "asset" },
  { label: "Zone", value: "zone" },
]

export const MaintenanceControls: FC<MaintenanceControlsProps> = ({
  filters,
  zones,
  onFiltersChange,
}) => {
  const update = (patch: Partial<MaintenanceFilters>) => onFiltersChange?.({ ...filters, ...patch })

  return (
    <section className="maintenance-controls" aria-label="Maintenance filters">
      <label className="search-control">
        <span>Search</span>
        <input
          type="search"
          value={filters.searchQuery}
          placeholder="Asset, vendor, task, note"
          onChange={(event) => update({ searchQuery: event.target.value })}
        />
      </label>
      <label>
        <span>Zone</span>
        <select value={filters.zone} onChange={(event) => update({ zone: event.target.value })}>
          {zones.map((zone) => <option key={zone}>{zone}</option>)}
        </select>
      </label>
      <label>
        <span>Status</span>
        <select
          value={filters.status}
          onChange={(event) => update({ status: event.target.value as MaintenanceFilters["status"] })}
        >
          {statuses.map((status) => <option key={status}>{status}</option>)}
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
