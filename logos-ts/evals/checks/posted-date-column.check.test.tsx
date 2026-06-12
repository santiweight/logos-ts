// Oracle for "add a Posted column (last) with postedAt as YYYY-MM-DD".
// Copied into <workspace>/frontend at check time; the agent never sees it.
import { test, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { JobTable } from "./components/JobTable"
import { baseJob } from "./fixtures"

test("Posted header exists and is the last column", () => {
  render(<JobTable jobs={[baseJob]} />)
  const headers = screen.getAllByRole("columnheader").map((h) => h.textContent?.trim())
  expect(headers[headers.length - 1]).toBe("Posted")
  expect(headers.length).toBe(8)
})

test("row shows the posted date as YYYY-MM-DD in the last cell", () => {
  render(<JobTable jobs={[baseJob]} />)
  const row = screen.getByText("Acme").closest("tr")!
  const cells = Array.from(row.querySelectorAll("td"))
  expect(cells.length).toBe(8)
  expect(cells[cells.length - 1]!.textContent).toContain("2026-05-01")
})

test("existing columns are untouched", () => {
  render(<JobTable jobs={[baseJob]} />)
  for (const h of ["Company", "Role", "Location", "Salary", "Tech", "Apply", "Details"])
    expect(screen.getByRole("columnheader", { name: h })).toBeTruthy()
})
