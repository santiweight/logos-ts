export type RecordCondition = "Mint" | "Near Mint" | "Very Good" | "Good"

export interface VinylRecord {
  id: string
  artist: string
  title: string
  year: number
  genre: string
  format: "LP" | "EP" | "Single" | "Box Set"
  condition: RecordCondition
  shelf: string
  colorway: string
  rating: number
  lastPlayed: string
  notes: string
}

export type SortMode = "recent" | "artist" | "rating" | "year"

export interface CollectionFilters {
  searchQuery: string
  genre: string
  shelf: string
  sortMode: SortMode
}
