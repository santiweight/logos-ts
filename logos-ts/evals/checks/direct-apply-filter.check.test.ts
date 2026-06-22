// Oracle for "Direct apply" filter. Copied into the HN Jobs project root.
import assert from "node:assert/strict";
import test from "node:test";
import {
  applyBucketsForJob,
  applyFilterLabel,
  jobMatchesFilters,
  parseJobFilters,
  type JobFilterable,
} from "./lib/job-filters";

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
    applyMethod: "hn-reply",
    applyUrl: null,
    applyEmail: null,
    remote: true,
    visa: false,
    intern: false,
    postedAt: new Date("2026-05-02T00:00:00Z"),
    ...overrides,
  };
}

test("Direct apply has a user-facing label", () => {
  assert.equal(applyFilterLabel("direct"), "Direct apply");
});

test("direct bucket includes application links and emails", () => {
  assert.equal(applyBucketsForJob(job({ applyUrl: "https://acme.example/jobs" })).includes("direct" as never), true);
  assert.equal(applyBucketsForJob(job({ applyEmail: "jobs@acme.example" })).includes("direct" as never), true);
});

test("apply=direct matches link or email jobs", () => {
  const filters = parseJobFilters(new URLSearchParams("apply=direct"));
  assert.equal(jobMatchesFilters(job({ applyUrl: "https://acme.example/jobs" }), filters), true);
  assert.equal(jobMatchesFilters(job({ applyEmail: "jobs@acme.example" }), filters), true);
});

test("apply=direct excludes HN-reply-only and missing apply jobs", () => {
  const filters = parseJobFilters(new URLSearchParams("apply=direct"));
  assert.equal(jobMatchesFilters(job({ applyMethod: "hn-reply" }), filters), false);
  assert.equal(jobMatchesFilters(job({ applyMethod: "missing" }), filters), false);
});

test("existing apply filters continue to work", () => {
  assert.equal(jobMatchesFilters(job({ applyUrl: "https://acme.example/jobs" }), parseJobFilters(new URLSearchParams("apply=link"))), true);
  assert.equal(jobMatchesFilters(job({ applyEmail: "jobs@acme.example" }), parseJobFilters(new URLSearchParams("apply=email"))), true);
  assert.equal(jobMatchesFilters(job({ applyMethod: "hn-reply" }), parseJobFilters(new URLSearchParams("apply=hn-reply"))), true);
});
