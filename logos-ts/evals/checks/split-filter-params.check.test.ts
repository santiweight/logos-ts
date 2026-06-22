// Oracle for splitting URL parameter parsing out of job-filters. Copied into
// the HN Jobs project root at check time; the agent never sees this file.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { parseJobFilters as parseFromNewModule } from "./lib/filter-params";
import {
  jobMatchesFilters,
  parseJobFilters as parseFromCompatibilityExport,
  sortJobsForDirectory,
} from "./lib/job-filters";

test("filter-params owns URL parsing and job-filters keeps predicate/sort logic", () => {
  assert.equal(existsSync("lib/filter-params.ts"), true);

  const filterParams = readFileSync("lib/filter-params.ts", "utf8");
  const jobFilters = readFileSync("lib/job-filters.ts", "utf8");

  assert.match(filterParams, /export function parseJobFilters/);
  assert.match(filterParams, /type SearchParamSource|interface SearchParamSource/);
  assert.doesNotMatch(jobFilters, /function parseJobFilters/);
  assert.match(jobFilters, /export \{[^}]*parseJobFilters|export\s+.*from\s+["']\.\/filter-params["']/s);
  assert.match(jobFilters, /export function jobMatchesFilters/);
  assert.match(jobFilters, /export function sortJobsForDirectory/);
});

test("new module and compatibility export parse the same filters", () => {
  const params = new URLSearchParams("q=rust&remote=1&apply=email&sort=salary-desc");

  assert.deepEqual(parseFromNewModule(params), parseFromCompatibilityExport(params));
  assert.equal(parseFromNewModule(params).q, "rust");
  assert.equal(parseFromNewModule(params).remote, true);
  assert.equal(parseFromNewModule(params).apply, "email");
  assert.equal(parseFromNewModule(params).sort, "salary-desc");
});

test("existing job filtering and sorting exports remain callable", () => {
  assert.equal(typeof jobMatchesFilters, "function");
  assert.equal(typeof sortJobsForDirectory, "function");
});
