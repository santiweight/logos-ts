import type { FC } from "react"
import type { Job } from "../../shared/types"
import { formatSalary, formatDate, hostLabel } from "../format"
import { ValueOrDash } from "./ValueOrDash"

interface FactTableProps {
  job: Job
}

function applyMethodLabel(method: string): string {
  switch (method) {
    case "link": return "Application link"
    case "email": return "Email"
    case "hn-reply": return "Reply on Hacker News"
    default: return "See posting"
  }
}

export const FactTable: FC<FactTableProps> = ({ job }) => {
  const salary = formatSalary(job.salaryMin, job.salaryMax, job.salaryCurrency, job.salaryPeriod)
  const roleSpecialties = job.roleSpecialties
  const hiringNotes = [
    job.visa ? "Sponsors visas." : null,
    job.intern ? "Interns welcome." : null,
  ].filter((n): n is string => n != null)

  return (
    <table className="fact-table">
      <tbody>
        {job.company && (
          <tr>
            <th>Company</th>
            <td>{job.company}</td>
          </tr>
        )}
        {job.websiteUrl && (
          <tr>
            <th>Website</th>
            <td>
              <a href={job.websiteUrl} target="_blank" rel="noopener noreferrer">
                {hostLabel(job.websiteUrl)} ↗
              </a>
            </td>
          </tr>
        )}
        {job.roles.length > 1 ? (
          <tr>
            <th>Roles</th>
            <td>
              <ul style={{ margin: 0, paddingLeft: 16 }}>
                {job.roles.map((r) => <li key={r}>{r}</li>)}
              </ul>
            </td>
          </tr>
        ) : job.role ? (
          <tr>
            <th>Role</th>
            <td>{job.role}</td>
          </tr>
        ) : null}
        {job.employmentType && (
          <tr>
            <th>Type</th>
            <td>{job.employmentType}</td>
          </tr>
        )}
        {(job.roleFamilies.length > 0 || job.seniority) && (
          <tr>
            <th>Role taxonomy</th>
            <td className="tags">
              {job.roleFamilies.map((f) => (
                <a key={f} href={`/?family=${encodeURIComponent(f)}`} className="t">
                  {f}
                </a>
              ))}
              {job.seniority && (
                <a href={`/?seniority=${encodeURIComponent(job.seniority)}`} className="t">
                  {job.seniority}
                </a>
              )}
            </td>
          </tr>
        )}
        {roleSpecialties.length > 0 && (
          <tr>
            <th>Specialties</th>
            <td>{roleSpecialties.join(", ")}</td>
          </tr>
        )}
        <tr>
          <th>Location</th>
          <td>
            <ValueOrDash value={job.locationDisplay} />
            {job.hybrid && !/(hybrid)/i.test(job.locationDisplay ?? "") && (
              <span className="pill hybrid">hybrid</span>
            )}
          </td>
        </tr>
        <tr>
          <th>Salary</th>
          <td>
            {salary ? (
              <>
                <span className="val">{salary}</span>
                {job.equity && <span className="muted small"> + equity</span>}
                {job.salaryText && job.salaryText !== salary && (
                  <span className="muted-2 small"> (&ldquo;{job.salaryText}&rdquo;)</span>
                )}
              </>
            ) : job.equity ? (
              "Equity mentioned"
            ) : (
              <span className="muted-2">—</span>
            )}
          </td>
        </tr>
        <tr>
          <th>Apply via</th>
          <td>
            {applyMethodLabel(job.applyMethod)}
            {job.applyUrl && (
              <>
                {" — "}
                <a href={job.applyUrl} target="_blank" rel="noopener noreferrer">
                  {job.applyUrl}
                </a>
              </>
            )}
            {job.applyEmail && (
              <>
                {job.applyUrl ? " · " : " — "}
                <a href={`mailto:${job.applyEmail}`}>{job.applyEmail}</a>
              </>
            )}
          </td>
        </tr>
        <tr>
          <th>Hiring notes</th>
          <td>
            {hiringNotes.length > 0 ? hiringNotes.join(" ") : <span className="muted-2">—</span>}
          </td>
        </tr>
        {job.tags.length > 0 && (
          <tr>
            <th>Tech</th>
            <td className="tags">
              {job.tags.map((t) => (
                <a key={t} href={`/?tag=${encodeURIComponent(t)}`} className="t">
                  {t}
                </a>
              ))}
            </td>
          </tr>
        )}
        {job.locations.length > 0 && (
          <tr>
            <th>Parsed locations</th>
            <td>{job.locations.join(", ")}</td>
          </tr>
        )}
        {job.locationRegions.length > 0 && (
          <tr>
            <th>Regions</th>
            <td>{job.locationRegions.join(", ")}</td>
          </tr>
        )}
        <tr>
          <th>Posted by</th>
          <td>{job.author}</td>
        </tr>
        <tr>
          <th>Posted</th>
          <td>{formatDate(job.postedAt)}</td>
        </tr>
        <tr>
          <th>Source</th>
          <td>
            <a href={job.hnUrl} target="_blank" rel="noopener noreferrer">
              View on Hacker News ↗
            </a>
          </td>
        </tr>
      </tbody>
    </table>
  )
}