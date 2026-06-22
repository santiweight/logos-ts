// Oracle for "salary range filter". Copied into the HN Jobs project root.
import assert from "node:assert/strict";
import test from "node:test";
import { jobMatchesFilters, parseJobFilters, type JobFilterable } from "./lib/job-filters";

function job(overrides: Partial<JobFilterable> = {}): JobFilterable {
  return {
    company: "Acme",
    role: "Backend Engineer",
    rawText: "Acme is hiring backend engineers.",
    author: "whoishiring",
    locationDisplay: "Remote (US)",
    locationRegions: JSON.stringify(["US"]),
    websiteUrl: "https://acme.example",
    tags: JSON.stringify(["TypeScript"]),
    roleFamilies: JSON.stringify(["Backend"]),
    seniority: "Senior",
    salaryBucket: "disclosed",
    salaryMin: 120000,
    salaryMax: 160000,
    applyMethod: "link",
    applyUrl: "https://acme.example/jobs",
    applyEmail: null,
    remote: true,
    visa: false,
    intern: false,
    postedAt: new Date("2026-05-02T00:00:00Z"),
    ...overrides,
  };
}

test("minSalary matches jobs whose disclosed range overlaps the lower bound", () => {
  assert.equal(jobMatchesFilters(job(), parseJobFilters(new URLSearchParams("minSalary=150000"))), true);
  assert.equal(jobMatchesFilters(job(), parseJobFilters(new URLSearchParams("minSalary=170000"))), false);
});

test("maxSalary matches jobs whose disclosed range overlaps the upper bound", () => {
  assert.equal(jobMatchesFilters(job(), parseJobFilters(new URLSearchParams("maxSalary=130000"))), true);
  assert.equal(jobMatchesFilters(job(), parseJobFilters(new URLSearchParams("maxSalary=100000"))), false);
});

test("combined bounds require salary range overlap", () => {
  assert.equal(jobMatchesFilters(job(), parseJobFilters(new URLSearchParams("minSalary=130000&maxSalary=150000"))), true);
  assert.equal(jobMatchesFilters(job(), parseJobFilters(new URLSearchParams("minSalary=170000&maxSalary=190000"))), false);
});

test("salary bounds exclude undisclosed salaries", () => {
  const undisclosed = job({ salaryBucket: null, salaryMin: null, salaryMax: null });
  assert.equal(jobMatchesFilters(undisclosed, parseJobFilters(new URLSearchParams("minSalary=1"))), false);
});

test("invalid salary bounds are ignored", () => {
  assert.equal(jobMatchesFilters(job(), parseJobFilters(new URLSearchParams("minSalary=abc&maxSalary=-10"))), true);
});
