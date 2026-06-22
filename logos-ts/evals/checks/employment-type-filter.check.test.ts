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

test("parseJobFilters accepts only supported employment type values", () => {
  assert.equal(parseJobFilters(new URLSearchParams("type=contract")).type, "contract");
  assert.equal(parseJobFilters(new URLSearchParams("type=internship")).type, "internship");
  assert.equal(parseJobFilters(new URLSearchParams("type=freelance")).type, undefined);
});

test("type filter matches employmentType exactly", () => {
  const filters = parseJobFilters(new URLSearchParams("type=contract"));
  assert.equal(jobMatchesFilters(job({ employmentType: "contract" }), filters), true);
  assert.equal(jobMatchesFilters(job({ employmentType: "full-time" }), filters), false);
  assert.equal(jobMatchesFilters(job({ employmentType: null }), filters), false);
});

test("invalid type values are ignored and other filters still compose", () => {
  assert.equal(jobMatchesFilters(job({ employmentType: "contract" }), parseJobFilters(new URLSearchParams("type=freelance"))), true);
  assert.equal(
    jobMatchesFilters(job({ employmentType: "contract", remote: false }), parseJobFilters(new URLSearchParams("type=contract&remote=1"))),
    false,
  );
});

test("DirectoryPage preserves and exposes the employment type filter", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  assert.match(page, /name=["']type["']|name=\{["']type["']\}/);
  assert.match(page, /buildHref\([^)]*["']type["'][^)]*["']contract["'][^)]*\)/s);
  assert.match(page, /title=["']Type["']|>\s*Type\s*</);
});
