// Oracle for "all months" directory/API filtering. Copied into the HN Jobs
// project root so it can import the candidate's month helper and inspect the
// server components/routes without needing a live Prisma database.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolveMonthFilter } from "./lib/month-filter";

test("month=all resolves to no month predicate", () => {
  assert.deepEqual(resolveMonthFilter("all", "2026-06"), {
    effectiveMonth: undefined,
    allMonths: true,
  });
});

test("default and explicit month behavior stays stable", () => {
  assert.deepEqual(resolveMonthFilter(undefined, "2026-06"), {
    effectiveMonth: "2026-06",
    allMonths: false,
  });
  assert.deepEqual(resolveMonthFilter("2026-04", "2026-06"), {
    effectiveMonth: "2026-04",
    allMonths: false,
  });
});

test("DirectoryPage exposes and preserves an all-months option", () => {
  const page = readFileSync("app/page.tsx", "utf8");

  assert.match(page, /allMonths/);
  assert.match(page, /All\s+months/i);
  assert.match(page, /buildHref\(\s*searchParams\s*,\s*["']month["']\s*,\s*["']all["']\s*\)/);
  assert.match(page, /active:\s*allMonths/);
  assert.match(page, /effectiveMonth\s*\?\s*\{\s*thread:\s*\{\s*month:\s*effectiveMonth\s*\}\s*\}\s*:\s*\{\s*\}/s);
});

test("jobs API uses the shared all-months semantics", () => {
  const route = readFileSync("app/api/jobs/route.ts", "utf8");

  assert.match(route, /resolveMonthFilter/);
  assert.match(route, /effectiveMonth\s*\?\s*\{\s*thread:\s*\{\s*month:\s*effectiveMonth\s*\}\s*\}\s*:\s*\{\s*\}/s);
  assert.doesNotMatch(route, /const\s+month\s*=\s*url\.searchParams\.get\(["']month["']\)\s*\?\?\s*undefined/);
});
