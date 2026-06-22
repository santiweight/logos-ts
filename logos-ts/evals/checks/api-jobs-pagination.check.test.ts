// Oracle for adding offset pagination metadata to /api/jobs. This checks the
// route source because executing the handler would require a live Prisma DB.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = () => readFileSync("app/api/jobs/route.ts", "utf8");

test("API parses a non-negative offset and keeps the existing limit cap", () => {
  const source = route();

  assert.match(source, /searchParams\.get\(["']offset["']\)/);
  assert.match(source, /Math\.max\(\s*0\s*,[\s\S]*offset/s);
  assert.match(source, /Math\.min\([\s\S]*2000/s);
});

test("API computes total before slicing the paged response", () => {
  const source = route();
  const totalIndex = source.search(/\btotal\b\s*=/);
  const sliceIndex = source.search(/\.slice\(\s*offset\s*,\s*offset\s*\+\s*limit\s*\)/);

  assert.notEqual(totalIndex, -1, "expected a total count before pagination");
  assert.notEqual(sliceIndex, -1, "expected slicing by offset and limit");
  assert.equal(totalIndex < sliceIndex, true, "total should be computed before pagination slice");
});

test("API response includes stable pagination metadata", () => {
  const source = route();

  assert.match(source, /NextResponse\.json\(\s*\{[\s\S]*\btotal\b[\s\S]*\bcount\b[\s\S]*\blimit\b[\s\S]*\boffset\b[\s\S]*\bhasMore\b[\s\S]*\bnextOffset\b/s);
  assert.match(source, /(?:const\s+nextOffset\s*=\s*offset\s*\+\s*\w+\.length|hasMore\s*:\s*offset\s*\+\s*\w+\.length\s*<\s*total)/);
  assert.match(source, /hasMore\s*:\s*(?:nextOffset|offset\s*\+\s*\w+\.length)\s*<\s*total/);
  assert.match(source, /nextOffset\s*:\s*(?:(?:nextOffset|offset\s*\+\s*\w+\.length)\s*<\s*total|hasMore)\s*\?\s*(?:nextOffset|offset\s*\+\s*\w+\.length)\s*:\s*null/);
});

test("API no longer reports count as the pre-pagination total", () => {
  const source = route();

  assert.doesNotMatch(source, /return\s+NextResponse\.json\(\s*\{\s*count:\s*jobs\.length\s*,\s*jobs\s*\}\s*\)/);
});
