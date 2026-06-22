// Oracle for "posted-after filter". Copied into the HN Jobs project root.
import assert from "node:assert/strict";
import test from "node:test";
import { jobMatchesFilters, parseJobFilters, type JobFilterable } from "./lib/job-filters";

function job(postedAt: string): JobFilterable {
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
    postedAt: new Date(postedAt),
  };
}

test("postedAfter keeps jobs posted on the requested date", () => {
  assert.equal(
    jobMatchesFilters(job("2026-05-10T12:00:00Z"), parseJobFilters(new URLSearchParams("postedAfter=2026-05-10"))),
    true,
  );
});

test("postedAfter keeps jobs posted after the requested date", () => {
  assert.equal(
    jobMatchesFilters(job("2026-05-11T00:00:00Z"), parseJobFilters(new URLSearchParams("postedAfter=2026-05-10"))),
    true,
  );
});

test("postedAfter excludes older jobs", () => {
  assert.equal(
    jobMatchesFilters(job("2026-05-09T23:59:59Z"), parseJobFilters(new URLSearchParams("postedAfter=2026-05-10"))),
    false,
  );
});

test("invalid postedAfter values are ignored", () => {
  assert.equal(jobMatchesFilters(job("2026-05-01T00:00:00Z"), parseJobFilters(new URLSearchParams("postedAfter=soon"))), true);
});
