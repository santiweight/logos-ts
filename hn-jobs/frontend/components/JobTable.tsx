import type { FC } from "react"
import type { Job } from "../../shared/types"
import { JobRow } from "./JobRow"

interface JobTableProps {
  jobs: Job[]
}

export const JobTable: FC<JobTableProps> = ({ jobs }) => {
  return (
    <table className="data">
      <thead>
        <tr>
          <th>Company</th>
          <th>Role</th>
          <th>Location</th>
          <th>Salary</th>
          <th>Tech</th>
          <th>Apply</th>
          <th>Details</th>
        </tr>
      </thead>
      <tbody>
        {jobs.map((j) => (
          <JobRow key={j.id} job={j} />
        ))}
        {jobs.length === 0 && (
          <tr>
            <td colSpan={7} className="muted" style={{ padding: "12px" }}>
              No postings match. Try clearing filters.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  )
}
