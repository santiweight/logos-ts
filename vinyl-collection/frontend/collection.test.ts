import { describe, expect, it } from "vitest"
import { records } from "./data/records"
import { averageRating, filterRecords, uniqueValues } from "./collection"

describe("collection helpers", () => {
  it("filters by search, genre, and shelf", () => {
    const result = filterRecords(records, {
      searchQuery: "quiet",
      genre: "Quiet Storm",
      shelf: "Evening",
      sortMode: "recent",
    })

    expect(result.map((record) => record.title)).toEqual(["Promise"])
  })

  it("sorts high rated records by rating then artist", () => {
    const result = filterRecords(records, {
      searchQuery: "",
      genre: "All",
      shelf: "All",
      sortMode: "rating",
    })

    expect(result.slice(0, 4).map((record) => record.artist)).toEqual([
      "Burial",
      "Miles Davis",
      "Nina Simone",
      "Talking Heads",
    ])
  })

  it("sorts by recent plays, artist, and pressing year", () => {
    expect(filterRecords(records, {
      searchQuery: "",
      genre: "All",
      shelf: "All",
      sortMode: "recent",
    })[0]?.title).toBe("Pastel Blues")

    expect(filterRecords(records, {
      searchQuery: "",
      genre: "All",
      shelf: "All",
      sortMode: "artist",
    })[0]?.artist).toBe("Burial")

    expect(filterRecords(records, {
      searchQuery: "",
      genre: "All",
      shelf: "All",
      sortMode: "year",
    })[0]?.title).toBe("Con Todo El Mundo")
  })

  it("returns an empty result for impossible cross-filters", () => {
    const result = filterRecords(records, {
      searchQuery: "sade",
      genre: "Electronic",
      shelf: "Essentials",
      sortMode: "recent",
    })

    expect(result).toEqual([])
  })

  it("matches search input case-insensitively and ignores surrounding whitespace", () => {
    const result = filterRecords(records, {
      searchQuery: "  RAIN-WINDOW  ",
      genre: "All",
      shelf: "All",
      sortMode: "recent",
    })

    expect(result.map((record) => record.title)).toEqual(["Untrue"])
  })

  it("builds editable filter options", () => {
    expect(uniqueValues(records, "shelf")).toContain("Essentials")
    expect(averageRating(records)).toBeGreaterThan(4)
  })

  it("handles empty collections without inflated stats or filter options", () => {
    expect(uniqueValues([], "genre")).toEqual(["All"])
    expect(averageRating([])).toBe(0)
  })
})
