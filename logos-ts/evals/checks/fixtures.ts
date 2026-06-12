// Shared oracle fixture. Copied into <workspace>/frontend alongside each
// check file at check time; the agent never sees it.
import type { Job, JobFilters } from "../shared/types"

export const baseJob: Job = {
  id: 1,
  hnCommentId: "1",
  threadId: 1,
  author: "acme",
  postedAt: "2026-05-01T00:00:00Z",
  hnUrl: "https://news.ycombinator.com/item?id=1",
  rawHtml: "",
  rawText: "Acme | Senior Engineer | Remote",
  company: "Acme",
  websiteUrl: null,
  role: "Senior Engineer",
  roles: ["Senior Engineer"],
  employmentType: "full-time",
  locationDisplay: "Remote",
  locations: [],
  remote: true,
  onsite: false,
  hybrid: false,
  remoteScope: "US",
  salaryText: null,
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: null,
  salaryPeriod: null,
  equity: false,
  applyMethod: "link",
  applyUrl: null,
  applyEmail: null,
  visa: false,
  intern: false,
  tags: [],
  parseConfidence: "parsed",
  roleFamilies: ["engineering"],
  roleSpecialties: [],
  seniority: "senior",
  locationRegions: ["north-america"],
  salaryBucket: "undisclosed",
  enrichmentStatus: "skipped",
  hidden: false,
  hiddenReason: null,
}

export const job = (o: Partial<Job>): Job => ({ ...baseJob, ...o })

export const filters = (o: Partial<JobFilters>): JobFilters => ({
  remote: false,
  visa: false,
  intern: false,
  sort: "company",
  ...o,
})
