// Shared data model. The whole pipeline flows toward ParsedJob, then persists
// as Job. These are plain types (Logos context, not stubs).

export type ApplyMethod = "link" | "email" | "hn-reply" | "other"
export type SalaryPeriod = "year" | "hour" | "month"
export type ParseConfidence = "parsed" | "partial" | "raw-only"
export type ClassificationConfidence = "high" | "medium" | "low" | "unknown"
export type EnrichmentStatus = "pending" | "enriched" | "missed" | "skipped" | "failed"

// --- raw fetch I/O ---

export interface HiringThread {
  hnId: string
  title: string
  month: string | null        // "2026-05", derived from the title's month
  postedAt: string
}

export interface RawComment {
  hnCommentId: string
  author: string
  postedAt: string
  rawHtml: string
  rawText: string
}

// --- parse output (canonical structured posting) ---

export interface ParsedLocation {
  display: string | null      // remote folded in, e.g. "SF / Remote (US)"
  places: string[]
  remoteScope: string | null
}

export interface ParsedSalary {
  text: string | null
  min: number | null
  max: number | null
  currency: string | null     // normalized, e.g. "USD", "CAD"
  period: SalaryPeriod | null
  equity: boolean
}

export interface ParsedApply {
  method: ApplyMethod
  url: string | null          // careers/ATS link, distinct from company homepage
  email: string | null
}

export interface ParsedJob {
  company: string | null
  website: string | null
  role: string | null         // primary = roles[0]
  roles: string[]
  employmentType: string | null
  remote: boolean
  onsite: boolean
  hybrid: boolean
  visa: boolean
  intern: boolean
  location: ParsedLocation
  salary: ParsedSalary
  apply: ParsedApply
  tags: string[]
  parseConfidence: ParseConfidence
}

// --- taxonomy output ---

export interface JobTaxonomy {
  roleFamilies: string[]
  roleSpecialties: string[]
  seniority: string | null
  locationRegions: string[]
  salaryBucket: "disclosed" | "undisclosed"
  taxonomyVersion: string
  classificationConfidence: ClassificationConfidence
  needsReview: boolean
  reviewReason: string | null
}

// --- persisted records ---

export interface Thread {
  id: number
  hnId: string
  title: string
  month: string
  postedAt: string
  jobCount: number
  lastIngestedAt: string | null
}

// raw* is the immutable source of truth; everything else is a derived cache.
// hidden/hiddenReason are admin-owned — ingest never writes them.
export interface Job {
  id: number
  hnCommentId: string
  threadId: number
  author: string
  postedAt: string
  hnUrl: string
  rawHtml: string
  rawText: string
  company: string | null
  websiteUrl: string | null
  role: string | null
  roles: string[]
  employmentType: string | null
  locationDisplay: string | null
  locations: string[]
  remote: boolean
  onsite: boolean
  hybrid: boolean
  remoteScope: string | null
  salaryText: string | null
  salaryMin: number | null
  salaryMax: number | null
  salaryCurrency: string | null
  salaryPeriod: string | null
  equity: boolean
  applyMethod: ApplyMethod
  applyUrl: string | null
  applyEmail: string | null
  visa: boolean
  intern: boolean
  tags: string[]
  parseConfidence: ParseConfidence
  roleFamilies: string[]
  roleSpecialties: string[]
  seniority: string | null
  locationRegions: string[]
  salaryBucket: "disclosed" | "undisclosed"
  enrichmentStatus: EnrichmentStatus
  hidden: boolean
  hiddenReason: string | null
}

// --- directory query/filter ---

export type JobSort = "company" | "newest" | "salary-desc"
export type ApplyFilter = "link" | "email" | "hn-reply" | "missing"

export interface JobFilters {
  q?: string
  month?: string
  tag?: string
  family?: string
  seniority?: string
  region?: string
  salary?: "disclosed"
  apply?: ApplyFilter
  remote: boolean
  visa: boolean
  intern: boolean
  sort: JobSort
}
