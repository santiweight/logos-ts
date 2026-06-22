import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { jobMatchesFilters, parseJobFilters, type JobFilterable } from "./lib/job-filters";

function job(overrides: Partial<JobFilterable> = {}): JobFilterable {
  return {
    company: "Acme",
    role: "Backend Engineer",
    roles: JSON.stringify(["Backend Engineer"]),
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
    employmentType: "full-time",
    remote: true,
    onsite: false,
    hybrid: false,
    visa: false,
    intern: false,
    postedAt: new Date("2026-05-02T00:00:00Z"),
    ...overrides,
  };
}

test("parseJobFilters accepts only supported workMode values", () => {
  assert.equal(parseJobFilters(new URLSearchParams("workMode=remote")).workMode, "remote");
  assert.equal(parseJobFilters(new URLSearchParams("workMode=hybrid")).workMode, "hybrid");
  assert.equal(parseJobFilters(new URLSearchParams("workMode=onsite")).workMode, "onsite");
  assert.equal(parseJobFilters(new URLSearchParams("workMode=anywhere")).workMode, undefined);
});

test("workMode matches the corresponding job location booleans", () => {
  assert.equal(jobMatchesFilters(job({ remote: true, hybrid: false, onsite: false }), parseJobFilters(new URLSearchParams("workMode=remote"))), true);
  assert.equal(jobMatchesFilters(job({ remote: false, hybrid: true, onsite: false }), parseJobFilters(new URLSearchParams("workMode=hybrid"))), true);
  assert.equal(jobMatchesFilters(job({ remote: false, hybrid: false, onsite: true }), parseJobFilters(new URLSearchParams("workMode=onsite"))), true);
});

test("workMode excludes non-matching modes and remote=1 still works", () => {
  assert.equal(jobMatchesFilters(job({ remote: false, hybrid: true }), parseJobFilters(new URLSearchParams("workMode=remote"))), false);
  assert.equal(jobMatchesFilters(job({ remote: true, hybrid: false }), parseJobFilters(new URLSearchParams("workMode=hybrid"))), false);
  assert.equal(jobMatchesFilters(job({ remote: true }), parseJobFilters(new URLSearchParams("remote=1"))), true);
  assert.equal(jobMatchesFilters(job({ remote: false, hybrid: true }), parseJobFilters(new URLSearchParams("remote=1"))), false);
});

test("DirectoryPage preserves and exposes the work mode filter", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  assert.match(page, /name=["']workMode["']|name=\{["']workMode["']\}/);
  assert.match(page, /buildHref\([^)]*["']workMode["'][^)]*(?:["']hybrid["']|key)[^)]*\)/s);
  assert.match(page, /["']hybrid["']/);
  assert.match(page, /Work\s+mode/i);
});
