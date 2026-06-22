// Eval oracle for the "make search fuzzy" change. Copied into the HN Jobs
// project root at check time so it can import the agent-edited filter module.
// The agent never sees this file.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import {
  jobMatchesFilters,
  parseJobFilters,
  sortJobsForDirectory,
  type JobFilterable,
} from "./lib/job-filters"

function job(overrides: Partial<JobFilterable> = {}): JobFilterable {
  return {
    company: "Acme",
    role: "Backend Engineer",
    rawText: "Acme is hiring backend engineers for distributed systems.",
    author: "whoishiring",
    locationDisplay: "Remote (US)",
    locationRegions: JSON.stringify(["US"]),
    websiteUrl: "https://acme.com",
    tags: JSON.stringify(["Go", "PostgreSQL"]),
    roleFamilies: JSON.stringify(["Backend"]),
    seniority: "Senior",
    salaryBucket: "disclosed",
    salaryMin: 140000,
    salaryMax: 180000,
    applyMethod: "link",
    applyUrl: "https://acme.com/careers",
    applyEmail: null,
    remote: true,
    visa: false,
    intern: false,
    postedAt: new Date("2026-05-02T00:00:00Z"),
    ...overrides,
  }
}

test("exact substring still matches", () => {
  assert.equal(jobMatchesFilters(job(), parseJobFilters(new URLSearchParams("q=engineer"))), true)
})

test("single-word typo tolerance matches the backend filter", () => {
  assert.equal(jobMatchesFilters(job(), parseJobFilters(new URLSearchParams("q=enginer"))), true)
})

test("multi-word typo tolerance matches the backend filter", () => {
  assert.equal(
    jobMatchesFilters(
      job({ role: "Senior Platform Engineer", rawText: "Senior Platform Engineer role" }),
      parseJobFilters(new URLSearchParams("q=platfrm enginer")),
    ),
    true,
  )
})

test("unrelated query does not match", () => {
  assert.equal(jobMatchesFilters(job(), parseJobFilters(new URLSearchParams("q=zzzqqq"))), false)
})

test("other filters still apply alongside fuzzy text search", () => {
  assert.equal(
    jobMatchesFilters(job({ remote: false }), parseJobFilters(new URLSearchParams("q=enginer&remote=1"))),
    false,
  )
})

test("query-aware directory sorting ranks stronger fuzzy matches first", () => {
  const rows = [
    job({
      company: "Aardvark",
      role: "Designer",
      rawText: "This posting mentions backend engineer once in a paragraph.",
      postedAt: new Date("2026-05-03T00:00:00Z"),
    }),
    job({
      company: "Zeta",
      role: "Backend Engineer",
      rawText: "Backend Engineer",
      postedAt: new Date("2026-05-01T00:00:00Z"),
    }),
  ]

  assert.deepEqual(
    sortJobsForDirectory(rows, "company", "bckend enginer").map((row) => row.company),
    ["Zeta", "Aardvark"],
  )
})

test("DirectoryPage wires the search query into relevance sorting", () => {
  const page = readFileSync("app/page.tsx", "utf8")
  assert.match(page, /sortJobsForDirectory\([\s\S]*,\s*sort\s*,\s*(?:q|filters\.q)\s*\)/)
})
