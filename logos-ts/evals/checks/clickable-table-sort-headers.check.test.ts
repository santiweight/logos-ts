import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = () => readFileSync("app/page.tsx", "utf8");

function compact(text: string): string {
  return text.replace(/\s+/g, " ");
}

function assertHeaderSortLink(label: string, sortValue: string): void {
  const text = compact(source());
  const labelPattern = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sortPattern = sortValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const directHeaderLink = new RegExp(
    `<th[^>]*>\\s*<(?:Link|a)[^>]+href=\\{[^}]*["']sort["'][^}]*["']${sortPattern}["'][^}]*\\}[^>]*>[^<]*${labelPattern}`,
    "i",
  );
  const helperHeader = new RegExp(
    `<SortHeader[^>]+label=["']${labelPattern}["'][^>]+sort=["']${sortPattern}["']|<SortHeader[^>]+sort=["']${sortPattern}["'][^>]+label=["']${labelPattern}["']`,
    "i",
  );
  assert.ok(
    directHeaderLink.test(text) || helperHeader.test(text),
    `Expected ${label} table header to link to sort=${sortValue}`,
  );
}

test("Company, Role, Salary, and Posted headers are clickable sort controls", () => {
  assertHeaderSortLink("Company", "company");
  assertHeaderSortLink("Role", "role");
  assertHeaderSortLink("Salary", "salary-desc");
  assertHeaderSortLink("Posted", "newest");
});

test("header sort links use shared URL-state builder and preserve active params", () => {
  const page = source();
  for (const value of ["company", "role", "salary-desc", "newest"]) {
    assert.match(page, new RegExp(`buildHref\\([^)]*["']sort["'][^)]*["']${value.replace("-", "\\-")}["'][^)]*\\)`, "s"));
  }
});

test("active sort is exposed accessibly", () => {
  const page = source();
  assert.match(page, /aria-current|aria-sort|data-active-sort/);
});
