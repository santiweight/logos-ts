import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { job } from "./full-fixtures";
import { jobMatchesFilters, parseJobFilters } from "./lib/job-filters";

test("fuzzy helpers are implemented in lib/job-filters.ts, not a new frontend component", () => {
  const source = readFileSync("lib/job-filters.ts", "utf8");
  const fnCount = (source.match(/function\s+\w+\s*\(/g) ?? []).length;
  assert.ok(fnCount >= 3, `Expected at least 3 helper functions in job-filters.ts for fuzzy search, found ${fnCount}`);
  assert.ok(
    !/FuzzySearch|SearchBar|"use client"/.test(source),
    "Fuzzy search should be backend logic in job-filters.ts, not a client component"
  );
});

test("exact substring still matches", () => {
  assert.equal(jobMatchesFilters(job(), parseJobFilters(new URLSearchParams("q=backend"))), true);
  assert.equal(jobMatchesFilters(job(), parseJobFilters(new URLSearchParams("q=acme"))), true);
});

test("single-word typo is tolerated", () => {
  assert.equal(jobMatchesFilters(job(), parseJobFilters(new URLSearchParams("q=enginer"))), true);
  assert.equal(jobMatchesFilters(job(), parseJobFilters(new URLSearchParams("q=bakend"))), true);
});

test("multi-word query requires all tokens", () => {
  assert.equal(jobMatchesFilters(job(), parseJobFilters(new URLSearchParams("q=acm enginer"))), true);
  assert.equal(jobMatchesFilters(job(), parseJobFilters(new URLSearchParams("q=acm zzzqqq"))), false);
});

test("completely unrelated query is rejected", () => {
  assert.equal(jobMatchesFilters(job(), parseJobFilters(new URLSearchParams("q=zzzqqq"))), false);
});

test("empty query matches everything", () => {
  assert.equal(jobMatchesFilters(job(), parseJobFilters(new URLSearchParams(""))), true);
  assert.equal(jobMatchesFilters(job(), parseJobFilters(new URLSearchParams("q="))), true);
});

test("other filters still compose with fuzzy search", () => {
  assert.equal(
    jobMatchesFilters(job({ remote: false }), parseJobFilters(new URLSearchParams("q=enginer&remote=1"))),
    false
  );
});
