import type { FC } from "react"
import type { MaintenanceSummary } from "../types"

interface SummaryStripProps {
  summary: MaintenanceSummary
  activeZone: string
}

export const SummaryStrip: FC<SummaryStripProps> = ({ summary, activeZone }) => {
  return (
    <section className="summary-strip" aria-label="Maintenance summary">
      <div>
        <span>{summary.totalTasks}</span>
        <small>tasks</small>
      </div>
      <div>
        <span>{summary.visibleTasks}</span>
        <small>shown</small>
      </div>
      <div>
        <span>{summary.overdueTasks}</span>
        <small>overdue</small>
      </div>
      <div>
        <span>{summary.criticalTasks}</span>
        <small>critical</small>
      </div>
      <div>
        <span>{activeZone}</span>
        <small>zone</small>
      </div>
    </section>
  )
}
