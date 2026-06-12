// Oracle for "change the empty-state message". Copied into
// <workspace>/frontend at check time; the agent never sees this file.
import { test, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { JobTable } from "./components/JobTable"
import { baseJob } from "./fixtures"

test("empty table shows the exact new message", () => {
  render(<JobTable jobs={[]} />)
  expect(screen.getByText("No jobs found — try removing some filters.")).toBeTruthy()
  expect(screen.queryByText("No postings match. Try clearing filters.")).toBeNull()
})

test("message is absent when jobs exist; rows still render", () => {
  render(<JobTable jobs={[baseJob]} />)
  expect(screen.queryByText("No jobs found — try removing some filters.")).toBeNull()
  expect(screen.getByText("Acme")).toBeTruthy()
})
