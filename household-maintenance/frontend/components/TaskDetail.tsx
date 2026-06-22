import type { FC } from "react"
import { dueLabel } from "../maintenance"
import type { MaintenanceTask } from "../types"

interface TaskDetailProps {
  totalTasks: number
  task?: MaintenanceTask | undefined
}

export const TaskDetail: FC<TaskDetailProps> = ({ totalTasks, task }) => {
  return (
    <aside className="task-detail" aria-label="Selected maintenance task">
      <p className="eyebrow">Next action</p>
      {task ? (
        <>
          <div className={`detail-badge priority-${task.priority.toLowerCase()}`}>{task.priority}</div>
          <h2>{task.asset}</h2>
          <p className="task-name">{task.task}</p>
          <dl>
            <div><dt>Status</dt><dd>{task.status}</dd></div>
            <div><dt>Due</dt><dd>{task.dueDate}</dd></div>
            <div><dt>Window</dt><dd>{dueLabel(task.dueDate)}</dd></div>
            <div><dt>Zone</dt><dd>{task.zone}</dd></div>
            <div><dt>Owner</dt><dd>{task.owner}</dd></div>
            <div><dt>Vendor</dt><dd>{task.vendor}</dd></div>
          </dl>
          <p className="detail-notes">{task.notes}</p>
        </>
      ) : (
        <p>{totalTasks === 0 ? "Add maintenance tasks to build an operations queue." : "Select a task to see owner, vendor, and service notes."}</p>
      )}
    </aside>
  )
}
