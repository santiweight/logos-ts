import type { FC } from "react"
import type { Job } from "../../shared/types"
import { formatMonth } from "../format"
import { FactTable } from "../components/FactTable"

interface JobDetailViewProps {
  job: Job
  threadMonth?: string
}

export const JobDetailView: FC<JobDetailViewProps> = ({ job, threadMonth }) => {
  return (
    <div>
      <p className="results-info">
        <a href="/">← All postings</a>
        {"  ·  "}
        {threadMonth && (
          <a href={`/?month=${threadMonth}`}>{formatMonth(threadMonth)} thread</a>
        )}
      </p>

      <h2 style={{ margin: "0 0 2px", fontSize: "18px" }}>
        {job.company ?? "Job posting"}
        {job.parseConfidence !== "parsed" && (
          <span className="muted-2 small">
            {" "}(auto-parsed{job.parseConfidence === "raw-only" ? " — see raw text" : ""})
          </span>
        )}
      </h2>
      {job.role && <p className="muted" style={{ margin: "0 0 12px" }}>{job.role}</p>}

      <FactTable job={job} />

      <h2 className="section">Original posting</h2>
      <div className="raw-body">{job.rawText}</div>
    </div>
  )
}
