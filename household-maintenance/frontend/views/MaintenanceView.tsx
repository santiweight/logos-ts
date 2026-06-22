import { useMemo, useState, type FC } from "react"
import { tasks as defaultTasks } from "../data/tasks"
import { filterTasks, summarizeTasks, uniqueZones } from "../maintenance"
import { MaintenanceControls } from "../components/MaintenanceControls"
import { SummaryStrip } from "../components/SummaryStrip"
import { TaskDetail } from "../components/TaskDetail"
import { TaskList } from "../components/TaskList"
import type { MaintenanceFilters, MaintenanceTask, TaskStatus } from "../types"

interface MaintenanceViewProps {
  tasks?: MaintenanceTask[]
  initialFilters?: MaintenanceFilters
  selectedTaskId?: string
}

const fallbackFilters: MaintenanceFilters = {
  searchQuery: "",
  zone: "All",
  status: "All",
  sortMode: "due",
}

const statuses: Array<"All" | TaskStatus> = ["All", "Overdue", "Due Soon", "Scheduled", "Watching"]

function normalizeOption<T extends string>(value: T, options: T[]): T {
  return options.includes(value) ? value : options[0]!
}

export const MaintenanceView: FC<MaintenanceViewProps> = ({
  tasks = defaultTasks,
  initialFilters = fallbackFilters,
  selectedTaskId,
}) => {
  const [filters, setFilters] = useState(initialFilters)
  const [selectedId, setSelectedId] = useState(selectedTaskId ?? "")
  const zones = useMemo(() => uniqueZones(tasks), [tasks])
  const activeFilters = useMemo<MaintenanceFilters>(() => ({
    ...filters,
    zone: normalizeOption(filters.zone, zones),
    status: normalizeOption(filters.status, statuses),
  }), [filters, zones])
  const visibleTasks = useMemo(() => filterTasks(tasks, activeFilters), [tasks, activeFilters])
  const selectedTask = visibleTasks.find((task) => task.id === selectedId) ?? visibleTasks[0]
  const summary = summarizeTasks(tasks, visibleTasks)

  return (
    <main className="maintenance-shell">
      <header className="maintenance-header">
        <div>
          <p className="eyebrow">Home operations</p>
          <h1>Household Maintenance</h1>
        </div>
        <SummaryStrip summary={summary} activeZone={activeFilters.zone} />
      </header>

      <MaintenanceControls
        filters={activeFilters}
        zones={zones}
        onFiltersChange={setFilters}
      />

      <section className="maintenance-layout">
        <TaskList totalTasks={tasks.length} tasks={visibleTasks} selectedTaskId={selectedTask?.id} onTaskSelect={setSelectedId} />
        <TaskDetail totalTasks={tasks.length} task={selectedTask} />
      </section>
    </main>
  )
}
