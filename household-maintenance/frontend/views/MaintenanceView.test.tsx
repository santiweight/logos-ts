import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { tasks } from "../data/tasks"
import { MaintenanceView } from "./MaintenanceView"

function taskPanel() {
  return screen.getByLabelText("Maintenance tasks")
}

function detailPanel() {
  return screen.getByLabelText("Selected maintenance task")
}

function visibleAssets(): Array<string | null> {
  return within(taskPanel()).getAllByRole("button").map((button) => {
    return within(button).getByText((_, element) => element?.tagName.toLowerCase() === "strong").textContent
  })
}

describe("MaintenanceView user stories", () => {
  it("opens as a daily scan with summary and first due task", () => {
    render(<MaintenanceView tasks={tasks} />)

    expect(screen.getByRole("heading", { name: "Household Maintenance" })).toBeTruthy()
    expect(screen.getByLabelText("Maintenance summary").textContent).toContain("7")
    expect(visibleAssets().slice(0, 2)).toEqual(["Smoke detectors", "Sump pump"])
    expect(within(detailPanel()).getByRole("heading", { name: "Smoke detectors" })).toBeTruthy()
  })

  it("triages overdue critical work", () => {
    render(<MaintenanceView tasks={tasks} />)

    fireEvent.change(screen.getByRole("combobox", { name: "Status" }), {
      target: { value: "Overdue" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Priority" }))

    expect(visibleAssets()).toEqual(["Smoke detectors", "Sump pump"])
    expect(screen.getByRole("button", { name: "Priority" }).getAttribute("aria-pressed")).toBe("true")
  })

  it("filters to a zone planning batch", () => {
    render(<MaintenanceView tasks={tasks} />)

    fireEvent.change(screen.getByRole("combobox", { name: "Zone" }), {
      target: { value: "Exterior" },
    })

    expect(visibleAssets()).toEqual(["Deck boards", "Irrigation manifold"])
    expect(screen.getByLabelText("Maintenance summary").textContent).toContain("2shown")
  })

  it("searches notes and vendors", () => {
    render(<MaintenanceView tasks={tasks} />)

    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "expansion tank" } })

    expect(visibleAssets()).toEqual(["Water heater"])
    expect(within(detailPanel()).getByText("Evergreen Plumbing")).toBeTruthy()
  })

  it("shows an empty state while preserving controls", () => {
    render(<MaintenanceView tasks={tasks} />)

    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "pool heater" } })

    expect(screen.getByRole("status").textContent).toContain("No maintenance tasks match")
    expect(within(taskPanel()).queryAllByRole("button")).toHaveLength(0)
    expect(screen.getByRole("combobox", { name: "Zone" })).toBeTruthy()
  })

  it("updates detail when a user selects a task", () => {
    render(<MaintenanceView tasks={tasks} />)

    fireEvent.click(screen.getByRole("button", { name: "Select Water heater" }))

    expect(screen.getByRole("button", { name: "Select Water heater" }).getAttribute("aria-pressed")).toBe("true")
    expect(within(detailPanel()).getByRole("heading", { name: "Water heater" })).toBeTruthy()
    expect(within(detailPanel()).getByText("Evergreen Plumbing")).toBeTruthy()
  })

  it("restores a selected task after temporary filters hide it", () => {
    render(<MaintenanceView tasks={tasks} />)

    fireEvent.click(screen.getByRole("button", { name: "Select Water heater" }))
    fireEvent.change(screen.getByRole("combobox", { name: "Zone" }), {
      target: { value: "Bedrooms" },
    })

    expect(within(detailPanel()).getByRole("heading", { name: "Smoke detectors" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Select Water heater" })).toBeNull()

    fireEvent.change(screen.getByRole("combobox", { name: "Zone" }), {
      target: { value: "All" },
    })

    expect(screen.getByRole("button", { name: "Select Water heater" }).getAttribute("aria-pressed")).toBe("true")
    expect(within(detailPanel()).getByRole("heading", { name: "Water heater" })).toBeTruthy()
  })

  it("normalizes invalid embedded filter and selected-task state", () => {
    render(<MaintenanceView
      tasks={tasks}
      initialFilters={{
        searchQuery: "",
        zone: "Attic",
        status: "Deferred" as never,
        sortMode: "due",
      }}
      selectedTaskId="missing-task"
    />)

    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Zone" }).value).toBe("All")
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Status" }).value).toBe("All")
    expect(visibleAssets()).toHaveLength(7)
    expect(within(detailPanel()).getByRole("heading", { name: "Smoke detectors" })).toBeTruthy()
  })

  it("handles an empty maintenance queue without implying a filter problem", () => {
    render(<MaintenanceView tasks={[]} />)

    expect(screen.getByRole("status").textContent).toContain("No maintenance tasks have been scheduled yet")
    expect(within(detailPanel()).getByText("Add maintenance tasks to build an operations queue.")).toBeTruthy()
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Zone" }).value).toBe("All")
    expect(screen.getByLabelText("Maintenance summary").textContent).toContain("0")
  })
})
