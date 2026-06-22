import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { records } from "../data/records"
import { CollectionView } from "./CollectionView"

function recordGrid() {
  return screen.getByLabelText("Records")
}

function nowPlaying() {
  return screen.getByLabelText("Now spinning")
}

describe("CollectionView user stories", () => {
  it("opens as a browsable crate with stats and a default now-playing record", () => {
    render(<CollectionView records={records} />)

    expect(screen.getByRole("heading", { name: "Vinyl Collection" })).toBeTruthy()
    expect(screen.getByLabelText("Collection stats").textContent).toContain("6")
    expect(within(recordGrid()).getAllByRole("article")).toHaveLength(6)
    expect(within(nowPlaying()).getByRole("heading", { name: "Pastel Blues" })).toBeTruthy()
  })

  it("searches artist, album, genre, and notes without changing the available controls", () => {
    render(<CollectionView records={records} />)

    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "rain-window" } })

    expect(within(recordGrid()).getAllByRole("article")).toHaveLength(1)
    expect(within(nowPlaying()).getByRole("heading", { name: "Untrue" })).toBeTruthy()
    expect(screen.getByRole("combobox", { name: "Genre" })).toBeTruthy()
    expect(screen.getByRole("combobox", { name: "Shelf" })).toBeTruthy()
  })

  it("combines shelf and genre filters for a listening context", () => {
    render(<CollectionView records={records} />)

    fireEvent.change(screen.getByRole("combobox", { name: "Shelf" }), {
      target: { value: "Essentials" },
    })
    fireEvent.change(screen.getByRole("combobox", { name: "Genre" }), {
      target: { value: "Fusion" },
    })

    expect(within(recordGrid()).getAllByRole("article")).toHaveLength(1)
    expect(within(nowPlaying()).getByRole("heading", { name: "In a Silent Way" })).toBeTruthy()
    expect(screen.getByLabelText("Collection stats").textContent).toContain("1shown")
  })

  it("shows a clear empty state for impossible searches", () => {
    render(<CollectionView records={records} />)

    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "not in this crate" } })

    expect(screen.getByRole("status").textContent).toContain("No records match this crate")
    expect(within(recordGrid()).queryAllByRole("article")).toHaveLength(0)
  })

  it("sorts deterministically and exposes the active sort state", () => {
    render(<CollectionView records={records} />)

    fireEvent.click(screen.getByRole("button", { name: "Top rated" }))

    expect(screen.getByRole("button", { name: "Top rated" }).getAttribute("aria-pressed")).toBe("true")
    const titles = within(recordGrid()).getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)
    expect(titles.slice(0, 4)).toEqual([
      "Untrue",
      "In a Silent Way",
      "Pastel Blues",
      "Remain in Light",
    ])
  })

  it("updates now-playing details when a user selects a cover", () => {
    render(<CollectionView records={records} />)

    fireEvent.click(screen.getByRole("button", { name: "Select Remain in Light" }))

    expect(screen.getByRole("button", { name: "Select Remain in Light" }).getAttribute("aria-pressed")).toBe("true")
    expect(within(nowPlaying()).getByRole("heading", { name: "Remain in Light" })).toBeTruthy()
    expect(within(nowPlaying()).getByText("Talking Heads")).toBeTruthy()
  })

  it("restores the user's selected record when a temporary filter is cleared", () => {
    render(<CollectionView records={records} />)

    fireEvent.click(screen.getByRole("button", { name: "Select Remain in Light" }))
    fireEvent.change(screen.getByRole("combobox", { name: "Shelf" }), {
      target: { value: "Essentials" },
    })

    expect(within(nowPlaying()).getByRole("heading", { name: "Pastel Blues" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Select Remain in Light" })).toBeNull()

    fireEvent.change(screen.getByRole("combobox", { name: "Shelf" }), {
      target: { value: "All" },
    })

    expect(screen.getByRole("button", { name: "Select Remain in Light" }).getAttribute("aria-pressed")).toBe("true")
    expect(within(nowPlaying()).getByRole("heading", { name: "Remain in Light" })).toBeTruthy()
  })

  it("normalizes invalid initial filters so embedded review fixtures remain usable", () => {
    render(<CollectionView
      records={records}
      initialFilters={{
        searchQuery: "",
        genre: "Missing genre",
        shelf: "Archive shelf",
        sortMode: "recent",
      }}
      featuredRecordId="missing-record"
    />)

    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Genre" }).value).toBe("All")
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Shelf" }).value).toBe("All")
    expect(within(recordGrid()).getAllByRole("article")).toHaveLength(6)
    expect(within(nowPlaying()).getByRole("heading", { name: "Pastel Blues" })).toBeTruthy()
    expect(screen.getByLabelText("Collection stats").textContent).toContain("All")
  })

  it("handles an empty collection fixture without implying a filter problem", () => {
    render(<CollectionView records={[]} />)

    expect(screen.getByRole("status").textContent).toContain("No records in this crate yet")
    expect(within(nowPlaying()).getByText("Add records to cue up a listening session.")).toBeTruthy()
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Genre" }).value).toBe("All")
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Shelf" }).value).toBe("All")
    expect(screen.getByLabelText("Collection stats").textContent).toContain("0")
  })
})
