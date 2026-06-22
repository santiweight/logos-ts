// Eval oracle for the directory fuzzy-search change. Copied into the workspace
// root at check time so the agent never sees it.
import assert from "node:assert/strict";
import test from "node:test";
import {
  jobMatchesFilters,
  parseJobFilters,
  type JobFilterable,
} from "./lib/job-filters";
import * as jobFilters from "./lib/job-filters";

declare const require: (id: string) => Record<string, unknown>;
const fuzzySearch = (() => {
  try {
    return require("./lib/fuzzy-search");
  } catch {
    return {};
  }
})();

function job(overrides: Partial<JobFilterable> = {}): JobFilterable {
  return {
    company: "Acme",
    role: "Backend Engineer",
    rawText: "Acme is hiring backend engineers for distributed systems. TypeScript, React, PostgreSQL.",
    author: "whoishiring",
    locationDisplay: "Remote (US)",
    locationRegions: JSON.stringify(["US"]),
    websiteUrl: "https://acme.com",
    tags: JSON.stringify(["TypeScript", "React", "PostgreSQL"]),
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
  };
}

function matches(row: JobFilterable, query: string): boolean {
  return score(row, query) > 0;
}

function rawScoreFn(): Function {
  const fromJobFilters = (jobFilters as Record<string, unknown>).fuzzyScore;
  if (typeof fromJobFilters === "function") return fromJobFilters;
  const fromFuzzySearch = (fuzzySearch as Record<string, unknown>).fuzzyScore;
  if (typeof fromFuzzySearch === "function") return fromFuzzySearch;
  throw new Error("expected a fuzzyScore export from lib/job-filters or lib/fuzzy-search");
}

function score(row: JobFilterable, query: string): number {
  const fn = rawScoreFn();
  try {
    const first = fn(row, query);
    if (typeof first === "number" && Number.isFinite(first)) return first;
  } catch {
    // Some implementations expose fuzzyScore(query, job).
  }
  const second = fn(query, row);
  if (typeof second === "number" && Number.isFinite(second)) return second;
  throw new Error("fuzzyScore must return a finite number for either (job, query) or (query, job)");
}

test("exact substring still matches", () => {
  assert.equal(matches(job(), "engineer"), true);
});

test("unrelated query does not match", () => {
  assert.equal(matches(job(), "zzzqqq"), false);
});

test("empty query passes the text filter", () => {
  assert.equal(jobMatchesFilters(job(), parseJobFilters(new URLSearchParams())), true);
});

test("single-word typo tolerance matches the intended posting", () => {
  assert.equal(matches(job({ company: "Stripe", role: "Engineer", tags: "[]" }), "enginer"), true);
});

test("multi-word typo tolerance matches a role phrase", () => {
  assert.equal(matches(job({ role: "Senior Platform Engineer", rawText: "Senior Platform Engineer" }), "platfrm enginer"), true);
});

test("other filters still apply alongside fuzzy search", () => {
  const filters = parseJobFilters(new URLSearchParams("remote=1"));
  const row = job({ remote: false });
  assert.equal(score(row, "enginer") > 0 && jobMatchesFilters(row, filters), false);
});

test("fuzzy scoring uses positive integer rank for near matches", () => {
  const value = score(job({ role: "Backend Engineer", rawText: "Backend Engineer TypeScript" }), "backend enginer");
  assert.equal(Number.isInteger(value), true);
  assert.equal(value > 0, true);
});

test("fuzzy scoring ranks stronger matches before weaker matches", () => {
  const strong = score(job({ company: "Acme", role: "Backend Engineer", rawText: "Backend Engineer TypeScript" }), "backend enginer");
  const weak = score(job({ company: "Almost", role: "Engineering Manager", rawText: "Engineering leadership" }), "backend enginer");
  const miss = score(job({ company: "Unrelated Systems", role: "Designer", rawText: "Product design role" }), "backend enginer");

  assert.equal(strong > weak, true);
  assert.equal(weak >= miss, true);
  assert.equal(miss, 0);
});
