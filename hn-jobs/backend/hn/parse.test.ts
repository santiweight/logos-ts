import { test, expect } from "vitest"
import { parseJob } from "./parse"

// Consumes only the free function parseJob -> attaches to the function.
test("classifies company by segment, not position", () => {
  const j = parseJob("Santa Clara, CA | ONSITE | Android Engineer | Jefit | $115K")
  expect(j.company).toBe("Jefit")
})

test("pulls multiple roles from header conjunctions", () => {
  const j = parseJob("Acme | Frontend and Backend Engineer | Remote (US)")
  expect(j.roles.length).toBeGreaterThan(1)
})
