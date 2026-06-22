import { describe, expect, it } from "vitest"
import { tasks } from "./data/tasks"
import { daysUntil, dueLabel, filterTasks, summarizeTasks, uniqueZones } from "./maintenance"

describe("maintenance helpers", () => {
  it("filters by search, zone, and status", () => {
    const result = filterTasks(tasks, {
      searchQuery: "battery",
      zone: "Bedrooms",
      status: "Overdue",
      sortMode: "due",
    })

    expect(result.map((task) => task.asset)).toEqual(["Smoke detectors"])
  })

  it("sorts by due date", () => {
    const result = filterTasks(tasks, {
      searchQuery: "",
      zone: "All",
      status: "All",
      sortMode: "due",
    })

    expect(result.slice(0, 3).map((task) => task.asset)).toEqual([
      "Smoke detectors",
      "Sump pump",
      "Air handler",
    ])
  })

  it("sorts by priority and due date tie-breaker", () => {
    const result = filterTasks(tasks, {
      searchQuery: "",
      zone: "All",
      status: "All",
      sortMode: "priority",
    })

    expect(result.slice(0, 3).map((task) => task.asset)).toEqual([
      "Smoke detectors",
      "Sump pump",
      "Air handler",
    ])
  })

  it("sorts by asset and zone", () => {
    expect(filterTasks(tasks, {
      searchQuery: "",
      zone: "All",
      status: "All",
      sortMode: "asset",
    })[0]?.asset).toBe("Air handler")

    expect(filterTasks(tasks, {
      searchQuery: "",
      zone: "All",
      status: "All",
      sortMode: "zone",
    })[0]?.zone).toBe("Basement")
  })

  it("summarizes all tasks while preserving visible count", () => {
    const visible = filterTasks(tasks, {
      searchQuery: "",
      zone: "Basement",
      status: "All",
      sortMode: "due",
    })

    expect(summarizeTasks(tasks, visible)).toEqual({
      totalTasks: 7,
      visibleTasks: 2,
      overdueTasks: 2,
      dueSoonTasks: 2,
      criticalTasks: 2,
    })
  })

  it("builds zones and due labels for empty and dated data", () => {
    expect(uniqueZones([])).toEqual(["All"])
    expect(uniqueZones(tasks)).toContain("Exterior")
    expect(daysUntil("2026-06-24")).toBe(2)
    expect(dueLabel("2026-06-22")).toBe("Due today")
    expect(dueLabel("2026-06-21")).toBe("1 days late")
  })
})
