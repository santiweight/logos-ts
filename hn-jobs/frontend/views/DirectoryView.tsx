import { type FC } from "react"
import type { Job } from "../../shared/types"
import { JobTable } from "../components/JobTable"

interface DirectoryViewProps {
  jobs: Job[]
  searchQuery: string
  onSearchChange?: (query: string) => void
}

export const DirectoryView: FC<DirectoryViewProps> = ({
  jobs,
  searchQuery,
  onSearchChange,
}) => {

  return (
    <div className="layout">
      <input
        className="searchbox"
        type="text"
        placeholder="Search postings…"
        value={searchQuery}
        onChange={(e) => onSearchChange?.(e.target.value)}
      />

      <main>
        <JobTable jobs={jobs} />
      </main>
    </div>
  )
}
