import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseJobFilters, sortJobsForDirectory, type JobFilterable } from "./lib/job-filters";

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

test("parseJobFilters accepts sort=role and still rejects invalid sort values", () => {
  assert.equal(parseJobFilters(new URLSearchParams("sort=role")).sort, "role");
  assert.equal(parseJobFilters(new URLSearchParams("sort=sideways")).sort, "company");
  assert.equal(parseJobFilters(new URLSearchParams("sort=sideways"), "newest").sort, "newest");
});

test("role sort browses by title, tie-breaks by company, and leaves missing roles last", () => {
  const rows = [
    job({ company: "Zeta", role: null, postedAt: new Date("2026-05-05T00:00:00Z") }),
    job({ company: "Beta", role: "Designer", postedAt: new Date("2026-05-04T00:00:00Z") }),
    job({ company: "Charlie", role: "Backend Engineer", postedAt: new Date("2026-05-03T00:00:00Z") }),
    job({ company: "Alpha", role: "Backend Engineer", postedAt: new Date("2026-05-01T00:00:00Z") }),
  ];

  assert.deepEqual(
    sortJobsForDirectory(rows, "role").map((row) => row.company),
    ["Alpha", "Charlie", "Beta", "Zeta"],
  );
});

test("DirectoryPage exposes a Role A-Z sort option wired through URL state", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  assert.match(page, /Role\s+A-?Z|Role\s+A.?Z/i);
  assert.match(page, /buildHref\([^)]*["']sort["'][^)]*["']role["'][^)]*\)/s);
});
