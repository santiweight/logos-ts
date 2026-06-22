// Oracle for "multi Tech tag filter". Copied into the HN Jobs project root.
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
    tags: JSON.stringify(["TypeScript", "React", "PostgreSQL"]),
    roleFamilies: JSON.stringify(["Backend"]),
    seniority: "Senior",
    salaryBucket: "disclosed",
    salaryMin: 140000,
    salaryMax: 180000,
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

test("single tag URLs keep working", () => {
  const filters = parseJobFilters(new URLSearchParams("tag=React"));
  assert.equal(jobMatchesFilters(job(), filters), true);
  assert.equal(jobMatchesFilters(job({ tags: JSON.stringify(["TypeScript"]) }), filters), false);
});

test("repeated tag params require every selected tag", () => {
  const params = new URLSearchParams();
  params.append("tag", "React");
  params.append("tag", "TypeScript");
  const filters = parseJobFilters(params);
  assert.equal(jobMatchesFilters(job(), filters), true);
  assert.equal(jobMatchesFilters(job({ tags: JSON.stringify(["React"]) }), filters), false);
});

test("comma-separated tag params require every selected tag", () => {
  const filters = parseJobFilters(new URLSearchParams("tag=React,PostgreSQL"));
  assert.equal(jobMatchesFilters(job(), filters), true);
  assert.equal(jobMatchesFilters(job({ tags: JSON.stringify(["React", "Go"]) }), filters), false);
});

test("multi-tag filtering composes with existing flags", () => {
  const filters = parseJobFilters(new URLSearchParams("tag=React&tag=TypeScript&remote=1"));
  assert.equal(jobMatchesFilters(job({ remote: true }), filters), true);
  assert.equal(jobMatchesFilters(job({ remote: false }), filters), false);
});
