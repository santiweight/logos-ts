// Extra oracle for fuzzy-search regressions seen in manual app trials. This is
// intentionally behavioral rather than tied to one scorer implementation.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  jobMatchesFilters,
  parseJobFilters,
  sortJobsForDirectory,
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
    rawText: "Acme is hiring backend engineers for distributed systems. PostgreSQL and Go experience helpful.",
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
  };
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
  throw new Error("fuzzyScore must return a finite number");
}

function matches(row: JobFilterable, query: string): boolean {
  return jobMatchesFilters(row, parseJobFilters(new URLSearchParams(`q=${encodeURIComponent(query)}`)));
}

test("handles missing, extra, substituted, and transposed query characters", () => {
  assert.equal(matches(job(), "postresql"), true);
  assert.equal(matches(job(), "postgrezsql"), true);
  assert.equal(matches(job(), "postgrexql"), true);
  assert.equal(matches(job(), "psotgresql"), true);
});

test("multi-token queries can match across structured fields but still require every token", () => {
  const row = job({
    company: "Neon",
    role: "Database Engineer",
    rawText: "Build hosted database infrastructure.",
    tags: JSON.stringify(["PostgreSQL"]),
  });

  assert.equal(matches(row, "neon postgrsql"), true);
  assert.equal(matches(row, "neon redis"), false);
});

test("role singular and plural forms do not become a false negative", () => {
  const row = job({
    company: "Tools Co",
    role: null,
    rawText: "We are hiring backend engineers to improve developer infrastructure.",
    tags: "[]",
  });

  assert.equal(matches(row, "engineer"), true);
});

test("unrelated design/product rows score zero for backend engineer typos", () => {
  const row = job({
    company: "Canvas",
    role: "Product Designer",
    rawText: "Product design role focused on research, prototyping, and visual systems.",
    tags: JSON.stringify(["Figma", "Research"]),
    roleFamilies: JSON.stringify(["Design"]),
    seniority: null,
  });

  assert.equal(score(row, "backend enginer"), 0);
  assert.equal(matches(row, "backend enginer"), false);
});

test("structured role/tag matches outrank repeated incidental raw-text mentions", () => {
  const structured = job({
    company: "Zeta",
    role: "Backend Engineer",
    rawText: "Build production services.",
    tags: JSON.stringify(["Go"]),
    postedAt: new Date("2026-05-01T00:00:00Z"),
  });
  const incidental = job({
    company: "Aardvark",
    role: "Engineering Manager",
    rawText: "This management post mentions backend engineer, backend engineer, and backend engineer in historical context.",
    tags: "[]",
    roleFamilies: JSON.stringify(["Management"]),
    postedAt: new Date("2026-05-03T00:00:00Z"),
  });

  assert.equal(score(structured, "backend enginer") > score(incidental, "backend enginer"), true);
  assert.deepEqual(
    sortJobsForDirectory([incidental, structured], "company", "backend enginer").map((row) => row.company),
    ["Zeta", "Aardvark"],
  );
});

test("DirectoryPage only wires q through and does not own fuzzy scoring logic", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  assert.match(page, /sortJobsForDirectory\([\s\S]*,\s*sort\s*,\s*(?:q|filters\.q)(?:\s*\|\|\s*undefined)?\s*,?\s*\)/);
  assert.doesNotMatch(page, /damerau|levenshtein|fuzzyScore|tokenScore|editDistance/i);
});
