// Eval oracle for the "make search fuzzy" change. Copied into <workspace>/frontend
// at check time so it can import the (agent-edited) backend + shared types and
// run under the frontend's vitest. The agent never sees this file.
import { test, expect } from "vitest"
import { jobMatchesFilters } from "../backend/job-filters"
import type { Job, JobFilters } from "../shared/types"

const baseJob: Job = {
  id: 1,
  hnCommentId: "1",
  threadId: 1,
  author: "acme",
  postedAt: "2026-05-01T00:00:00Z",
  hnUrl: "https://news.ycombinator.com/item?id=1",
  rawHtml: "",
  rawText: "Acme is hiring an Engineer. TypeScript, React.",
  company: "Acme",
  websiteUrl: null,
  role: "Engineer",
  roles: ["Engineer"],
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
  tags: ["TypeScript"],
  parseConfidence: "parsed",
  roleFamilies: ["engineering"],
  roleSpecialties: [],
  seniority: "mid",
  locationRegions: ["north-america"],
  salaryBucket: "undisclosed",
  enrichmentStatus: "skipped",
  hidden: false,
  hiddenReason: null,
}
const job = (o: Partial<Job>): Job => ({ ...baseJob, ...o })
const F = (o: Partial<JobFilters>): JobFilters => ({
  remote: false,
  visa: false,
  intern: false,
  sort: "company",
  ...o,
})

test("exact substring still matches", () => {
  expect(jobMatchesFilters(job({}), F({ q: "engineer" }))).toBe(true)
})

test("negative: unrelated query does not match", () => {
  expect(jobMatchesFilters(job({}), F({ q: "zzzqqq" }))).toBe(false)
})

test("empty query passes the text filter", () => {
  expect(jobMatchesFilters(job({}), F({}))).toBe(true)
})

test("single-word typo tolerance (enginer → Engineer)", () => {
  const j = job({ company: "Stripe", role: "Engineer", roles: ["Engineer"], tags: [], rawText: "Engineer role" })
  expect(jobMatchesFilters(j, F({ q: "enginer" }))).toBe(true)
})

test("multi-word typo tolerance (enginer → Senior Engineer)", () => {
  const j = job({ company: "Acme", role: "Senior Engineer", roles: ["Senior Engineer"], tags: [], rawText: "Senior Engineer" })
  expect(jobMatchesFilters(j, F({ q: "enginer" }))).toBe(true)
})

test("other filters still apply alongside q (remote)", () => {
  expect(jobMatchesFilters(job({ remote: false }), F({ remote: true }))).toBe(false)
})
