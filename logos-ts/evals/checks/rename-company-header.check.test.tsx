// Oracle for "rename the Company header to Employer". Copied into
// <workspace>/frontend at check time; the agent never sees this file.
import { test, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { JobTable } from "./components/JobTable"
import { baseJob } from "./fixtures"

test("header reads Employer, not Company", () => {
  render(<JobTable jobs={[baseJob]} />)
  expect(screen.getByRole("columnheader", { name: "Employer" })).toBeTruthy()
  expect(screen.queryByRole("columnheader", { name: "Company" })).toBeNull()
})

test("other headers and rows are untouched", () => {
  render(<JobTable jobs={[baseJob]} />)
  for (const h of ["Role", "Location", "Salary", "Tech", "Apply", "Details"])
    expect(screen.getByRole("columnheader", { name: h })).toBeTruthy()
  expect(screen.getByText("Acme")).toBeTruthy()
  expect(screen.getByText("Senior Engineer")).toBeTruthy()
})
