import type { FC } from "react"
import type { Job } from "../../shared/types"
import { formatSalary, formatCompanyName, hostLabel } from "../format"

interface JobRowProps {
  job: Job
}

export const JobRow: FC<JobRowProps> = ({ job }) => {
  const tags = job.tags
  const salary = formatSalary(job.salaryMin, job.salaryMax, job.salaryCurrency, job.salaryPeriod)
  const company = formatCompanyName(job.company)
  const websiteLabel = hostLabel(job.websiteUrl)
  const companyLabel = company ?? websiteLabel
  const roleLines = job.roles.length > 0 ? job.roles : job.role ? [job.role] : []
  const hiringFacts = [
    job.visa ? "visa sponsorship" : null,
    job.intern ? "interns welcome" : null,
  ].filter((fact): fact is string => !!fact)

  return (
    <tr>
      <td>
        {companyLabel && job.websiteUrl ? (
          <a
            href={job.websiteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={company ? `conf-${job.parseConfidence}` : "muted-2"}
          >
            {companyLabel}
          </a>
        ) : companyLabel ? (
          <span className={company ? `conf-${job.parseConfidence}` : "muted-2"}>
            {companyLabel}
          </span>
        ) : (
          <span className="muted-2">—</span>
        )}
      </td>
      <td>
        {roleLines.length > 0 ? (
          <div className="line-list role-list">
            {roleLines.map((role) => <div key={role} style={{ fontWeight: "bold" }}>{role}</div>)}
          </div>
        ) : (
          <span className="muted-2">—</span>
        )}
        {hiringFacts.length > 0 && (
          <div className="row-facts">
            {hiringFacts.map((fact) => <span key={fact}>{fact}</span>)}
          </div>
        )}
      </td>
      <td className="tag">{job.locationDisplay ?? <span className="muted-2">—</span>}</td>
      <td className="num">
        {salary ?? <span className="muted-2">—</span>}
        {job.equity && <span className="muted-2 small"> +eq</span>}
      </td>
      <td className="tags">
        {tags.slice(0, 4).map((t) => (
          <span className="t" key={t}>{t}</span>
        ))}
      </td>
      <td className="small">
        {job.applyUrl ? (
          <a href={job.applyUrl} target="_blank" rel="noopener noreferrer">apply ↗</a>
        ) : job.applyEmail ? (
          <a href={`mailto:${job.applyEmail}`}>email ↗</a>
        ) : (
          <span className="muted-2">—</span>
        )}
      </td>
      <td className="small">
        <a href={`/job/${job.id}`}>details</a>
      </td>
    </tr>
  )
}
