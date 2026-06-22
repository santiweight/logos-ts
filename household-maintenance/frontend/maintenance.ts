import type {
  MaintenanceFilters,
  MaintenanceSummary,
  MaintenanceTask,
  TaskPriority,
} from "./types"

const priorityRank: Record<TaskPriority, number> = {
  Critical: 0,
  High: 1,
  Medium: 2,
  Low: 3,
}

export function filterTasks(tasks: MaintenanceTask[], filters: MaintenanceFilters): MaintenanceTask[] {
  const query = filters.searchQuery.trim().toLowerCase()

  return tasks
    .filter((task) => {
      const searchable = [
        task.asset,
        task.task,
        task.zone,
        task.category,
        task.owner,
        task.vendor,
        task.notes,
      ].join(" ").toLowerCase()
      const matchesQuery = query === "" || searchable.includes(query)
      const matchesZone = filters.zone === "All" || task.zone === filters.zone
      const matchesStatus = filters.status === "All" || task.status === filters.status
      return matchesQuery && matchesZone && matchesStatus
    })
    .sort((a, b) => {
      if (filters.sortMode === "priority") {
        return priorityRank[a.priority] - priorityRank[b.priority] || a.dueDate.localeCompare(b.dueDate)
      }
      if (filters.sortMode === "asset") return a.asset.localeCompare(b.asset)
      if (filters.sortMode === "zone") return a.zone.localeCompare(b.zone) || a.dueDate.localeCompare(b.dueDate)
      return a.dueDate.localeCompare(b.dueDate)
    })
}

export function uniqueZones(tasks: MaintenanceTask[]): string[] {
  return ["All", ...Array.from(new Set(tasks.map((task) => task.zone))).sort()]
}

export function summarizeTasks(allTasks: MaintenanceTask[], visibleTasks: MaintenanceTask[]): MaintenanceSummary {
  return {
    totalTasks: allTasks.length,
    visibleTasks: visibleTasks.length,
    overdueTasks: allTasks.filter((task) => task.status === "Overdue").length,
    dueSoonTasks: allTasks.filter((task) => task.status === "Due Soon").length,
    criticalTasks: allTasks.filter((task) => task.priority === "Critical").length,
  }
}

export function daysUntil(dueDate: string, today = "2026-06-22"): number {
  const due = Date.parse(`${dueDate}T00:00:00Z`)
  const base = Date.parse(`${today}T00:00:00Z`)
  return Math.round((due - base) / 86_400_000)
}

export function dueLabel(dueDate: string, today = "2026-06-22"): string {
  const days = daysUntil(dueDate, today)
  if (days < 0) return `${Math.abs(days)} days late`
  if (days === 0) return "Due today"
  if (days === 1) return "Due tomorrow"
  return `Due in ${days} days`
}
