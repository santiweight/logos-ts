import type { FC } from "react"
import type { CollectionFilters, SortMode } from "../types"

interface ShelfFiltersProps {
  filters: CollectionFilters
  genres: string[]
  shelves: string[]
  onFiltersChange?: (filters: CollectionFilters) => void
}

const sortModes: Array<{ label: string; value: SortMode }> = [
  { label: "Recently played", value: "recent" },
  { label: "Artist A-Z", value: "artist" },
  { label: "Top rated", value: "rating" },
  { label: "Newest pressings", value: "year" },
]

export const ShelfFilters: FC<ShelfFiltersProps> = ({
  filters,
  genres,
  shelves,
  onFiltersChange,
}) => {
  const update = (patch: Partial<CollectionFilters>) => onFiltersChange?.({ ...filters, ...patch })

  return (
    <aside className="shelf-filters">
      <label>
        <span>Search</span>
        <input
          type="search"
          value={filters.searchQuery}
          placeholder="Artist, album, note"
          onChange={(event) => update({ searchQuery: event.target.value })}
        />
      </label>
      <label>
        <span>Genre</span>
        <select value={filters.genre} onChange={(event) => update({ genre: event.target.value })}>
          {genres.map((genre) => <option key={genre}>{genre}</option>)}
        </select>
      </label>
      <label>
        <span>Shelf</span>
        <select value={filters.shelf} onChange={(event) => update({ shelf: event.target.value })}>
          {shelves.map((shelf) => <option key={shelf}>{shelf}</option>)}
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
    </aside>
  )
}
