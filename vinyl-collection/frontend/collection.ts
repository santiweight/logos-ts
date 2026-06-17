import type { CollectionFilters, VinylRecord } from "./types"

export function filterRecords(records: VinylRecord[], filters: CollectionFilters): VinylRecord[] {
  const query = filters.searchQuery.trim().toLowerCase()

  return records
    .filter((record) => {
      const searchable = `${record.artist} ${record.title} ${record.genre} ${record.notes}`.toLowerCase()
      const matchesQuery = query === "" || searchable.includes(query)
      const matchesGenre = filters.genre === "All" || record.genre === filters.genre
      const matchesShelf = filters.shelf === "All" || record.shelf === filters.shelf
      return matchesQuery && matchesGenre && matchesShelf
    })
    .sort((a, b) => {
      if (filters.sortMode === "artist") return a.artist.localeCompare(b.artist)
      if (filters.sortMode === "rating") return b.rating - a.rating || a.artist.localeCompare(b.artist)
      if (filters.sortMode === "year") return b.year - a.year
      return b.lastPlayed.localeCompare(a.lastPlayed)
    })
}

export function uniqueValues(records: VinylRecord[], key: "genre" | "shelf"): string[] {
  return ["All", ...Array.from(new Set(records.map((record) => record[key]))).sort()]
}

export function averageRating(records: VinylRecord[]): number {
  if (records.length === 0) return 0
  return records.reduce((sum, record) => sum + record.rating, 0) / records.length
}
