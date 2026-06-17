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

    expect(result[0]?.rating).toBe(5)
    expect(result[0]?.artist.localeCompare(result[1]?.artist ?? "")).toBeLessThanOrEqual(0)
  })

  it("builds editable filter options", () => {
    expect(uniqueValues(records, "shelf")).toContain("Essentials")
    expect(averageRating(records)).toBeGreaterThan(4)
  })
})
