import type { FC } from "react"
import { dueLabel } from "../maintenance"
import type { MaintenanceTask } from "../types"

interface TaskListProps {
  totalTasks: number
  tasks: MaintenanceTask[]
  selectedTaskId?: string | undefined
  onTaskSelect?: ((id: string) => void) | undefined
}

export const TaskList: FC<TaskListProps> = ({ totalTasks, tasks, selectedTaskId, onTaskSelect }) => {
  const emptyMessage = totalTasks === 0
    ? "No maintenance tasks have been scheduled yet."
    : "No maintenance tasks match these filters. Adjust the zone, status, or search."

  return (
    <section className="task-panel" aria-label="Maintenance tasks">
      <header>
        <h2>Task queue</h2>
        <span>{tasks.length}</span>
      </header>
      <div className="task-list">
        {tasks.map((task) => (
          <article key={task.id} className={`task-row ${task.id === selectedTaskId ? "selected" : ""}`}>
            <button
              type="button"
              aria-label={`Select ${task.asset}`}
              aria-pressed={task.id === selectedTaskId}
              onClick={() => onTaskSelect?.(task.id)}
            >
              <span className={`status-dot status-${task.status.toLowerCase().replace(/\s+/g, "-")}`} />
              <span>
                <strong>{task.asset}</strong>
                <small>{task.task}</small>
              </span>
              <span className="task-meta">
                <em>{task.priority}</em>
                <small>{dueLabel(task.dueDate)}</small>
              </span>
            </button>
          </article>
        ))}
        {tasks.length === 0 && (
          <div className="empty-state" role="status">
            {emptyMessage}
          </div>
        )}
      </div>
    </section>
  )
}
