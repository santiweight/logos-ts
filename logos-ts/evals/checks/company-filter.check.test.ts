// Oracle for "company filter". Copied into the HN Jobs project root.
import assert from "node:assert/strict";
import test from "node:test";
import { jobMatchesFilters, parseJobFilters, type JobFilterable } from "./lib/job-filters";

function job(company: string | null, rawText = "A separate mention of Globex appears here."): JobFilterable {
  return {
    company,
    role: "Backend Engineer",
    rawText,
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
  };
}

test("company filter matches company names case-insensitively", () => {
  assert.equal(jobMatchesFilters(job("Acme Systems"), parseJobFilters(new URLSearchParams("company=acme"))), true);
});

test("company filter normalizes whitespace and supports substrings", () => {
  assert.equal(jobMatchesFilters(job("Acme Data Systems"), parseJobFilters(new URLSearchParams("company=data%20%20systems"))), true);
});

test("company filter does not match raw text when company differs", () => {
  assert.equal(jobMatchesFilters(job("Acme Systems"), parseJobFilters(new URLSearchParams("company=globex"))), false);
});

test("company filter composes with full-text q", () => {
  const filters = parseJobFilters(new URLSearchParams("company=acme&q=engineer"));
  assert.equal(jobMatchesFilters(job("Acme Systems", "Backend engineer role."), filters), true);
  assert.equal(jobMatchesFilters(job("Globex", "Backend engineer role at Acme competitor."), filters), false);
});
