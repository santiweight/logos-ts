export type TaskStatus = "Overdue" | "Due Soon" | "Scheduled" | "Watching"
export type TaskPriority = "Critical" | "High" | "Medium" | "Low"
export type SortMode = "due" | "priority" | "asset" | "zone"

export interface MaintenanceTask {
  id: string
  asset: string
  task: string
  zone: string
  category: string
  status: TaskStatus
  priority: TaskPriority
  dueDate: string
  lastService: string
  owner: string
  vendor: string
  notes: string
}

export interface MaintenanceFilters {
  searchQuery: string
  zone: string
  status: "All" | TaskStatus
  sortMode: SortMode
}

export interface MaintenanceSummary {
  totalTasks: number
  visibleTasks: number
  overdueTasks: number
  dueSoonTasks: number
  criticalTasks: number
}
