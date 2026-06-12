import type { Job, JobFilters, JobSort, ApplyFilter } from "../shared/types"

/**
 * Parse URL search params into a normalized JobFilters. Single source of truth
 * shared by the directory view and the JSON API.
 * @pure
 * @rules
 * - remote/visa/intern are true only for the literal value "1".
 * - sort defaults to defaultSort; unknown sort values fall back to it.
 * - q is trimmed; empty string becomes undefined.
 */
export function parseJobFilters(
  source: Record<string, string | undefined>,
  defaultSort: JobSort = "company"
): JobFilters {
  const q = (source.q ?? "").trim()
  const sort = validSort(source.sort, defaultSort)
  const apply = validApply(source.apply)
  const salary = source.salary === "disclosed" ? "disclosed" : undefined

  return {
    q: q || undefined,
    month: source.month,
    tag: source.tag,
    family: source.family,
    seniority: source.seniority,
    region: source.region,
    salary,
    apply,
    remote: source.remote === "1",
    visa: source.visa === "1",
    intern: source.intern === "1",
    sort,
  }
}

function validSort(value: string | undefined, fallback: JobSort): JobSort {
  if (value === "company" || value === "newest" || value === "salary-desc") {
    return value
  }
  return fallback
}

function validApply(value: string | undefined): ApplyFilter | undefined {
  if (value === "link" || value === "email" || value === "hn-reply" || value === "missing") {
    return value
  }
  return undefined
}

/**
 * True if a job should appear in the public directory at all (has a usable
 * signal — company or role or apply path — and isn't pure noise).
 * @pure
 */
export function hasPublicListingSignal(job: Job): boolean {
  if (job.company) return true
  if (job.role?.trim()) return true
  if (job.websiteUrl) return true
  if (job.applyUrl || job.applyEmail || job.applyMethod === "hn-reply") return true
  if (job.salaryBucket === "disclosed" || job.salaryMin != null || job.salaryMax != null) return true
  if (job.tags.length > 0) return true
  if (job.roleFamilies.length > 0 || job.seniority) return true
  if (isMeaningfulLocation(job.locationDisplay)) return true
  return hasSubstantiveRawText(job.rawText)
}

/**
 * Which apply buckets a job belongs to, for facet counts.
 * @pure
 * @rules
 * - "link" if applyUrl, "email" if applyEmail, else "missing".
 * - applyMethod "hn-reply" maps to the "hn-reply" bucket.
 */
export function applyBucketsForJob(job: Job): ApplyFilter[] {
  const buckets: ApplyFilter[] = []
  if (job.applyUrl) buckets.push("link")
  if (job.applyEmail) buckets.push("email")
  if (job.applyMethod === "hn-reply") buckets.push("hn-reply")
  if (buckets.length === 0) buckets.push("missing")
  return buckets
}

// Searchable text for a job (used by the fuzzy q filter).
function jobSearchText(job: Job): string {
  return [job.company, job.role, ...job.roles, ...job.tags, job.locationDisplay, ...job.locations, job.rawText]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
}

function isMeaningfulLocation(location: string | null): boolean {
  if (!location) return false
  const clean = location.replace(/\s+/g, " ").trim().toLowerCase()
  if (!clean) return false
  return !/^(?:remote(?:\s*\([^)]*\))?|on-?site|onsite|hybrid)$/.test(clean)
}

function hasSubstantiveRawText(rawText: string): boolean {
  const clean = rawText.replace(/\s+/g, " ").trim()
  if (!clean) return false
  if (/^(?:\[flagged\]|remote|n\/a|na|none|nope|test)$/i.test(clean)) return false
  const words = clean.match(/[a-z0-9][a-z0-9.+#'-]*/gi) ?? []
  return clean.length >= 80 && words.length >= 12
}

/**
 * True if a job satisfies every active filter (AND across dimensions).
 * @pure
 * @rules
 * - q is a fuzzy/token search: every whitespace-separated token must appear as a
 *   substring (case-insensitive) of the job's company/role/roles/tags/location/rawText.
 * - tag/family/seniority/region match membership in the job's arrays.
 * - remote/visa/intern require the corresponding boolean to be true.
 * - salary "disclosed" requires salaryBucket === "disclosed".
 */
export function jobMatchesFilters(job: Job, filters: JobFilters): boolean {
  const q = filters.q?.trim().toLowerCase()
  if (q) {
    const text = jobSearchText(job)
    if (!q.split(/\s+/).every((token) => text.includes(token))) return false
  }
  if (filters.tag && !job.tags.includes(filters.tag)) return false
  if (filters.family && !job.roleFamilies.includes(filters.family)) return false
  if (filters.seniority && job.seniority !== filters.seniority) return false
  if (filters.region && !job.locationRegions.includes(filters.region)) return false
  if (filters.remote && !job.remote) return false
  if (filters.visa && !job.visa) return false
  if (filters.intern && !job.intern) return false
  if (filters.salary === "disclosed" && job.salaryBucket !== "disclosed") return false
  if (filters.apply && !applyBucketsForJob(job).includes(filters.apply)) return false
  return true
}

/**
 * Stable sort of directory rows.
 * @pure
 * @rules
 * - "company": case-insensitive A–Z, blank companies last.
 * - "newest": postedAt descending.
 * - "salary-desc": salaryMax descending, undisclosed last.
 * @throws RangeError if sort is not a known JobSort
 */
export function sortJobsForDirectory(jobs: Job[], sort: JobSort): Job[] {
  if (sort !== "company" && sort !== "newest" && sort !== "salary-desc") {
    throw new RangeError(`Unknown sort: ${sort}`)
  }

  return [...jobs].sort((a, b) => {
    if (sort === "salary-desc") {
      const bySalary = salarySortValue(b) - salarySortValue(a)
      if (bySalary !== 0) return bySalary
    } else if (sort === "company") {
      const companyA = a.company?.trim() ?? "￿"
      const companyB = b.company?.trim() ?? "￿"
      const byCompany = companyA.localeCompare(companyB, undefined, { sensitivity: "base" })
      if (byCompany !== 0) return byCompany
    }
    // Fallback: newest first (postedAt descending)
    return new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime()
  })
}

function salarySortValue(job: Job): number {
  return job.salaryMax ?? job.salaryMin ?? Number.NEGATIVE_INFINITY
}
