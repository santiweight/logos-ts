import { test, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import type { Job } from "../shared/types"
import { JobRow } from "./components/JobRow"

const baseJob: Job = {
  id: 1,
  hnCommentId: "1",
  threadId: 1,
  author: "acme",
  postedAt: "2026-05-01T00:00:00Z",
  hnUrl: "https://news.ycombinator.com/item?id=1",
  rawHtml: "",
  rawText: "Acme | Senior Engineer | Remote",
  company: "Acme",
  websiteUrl: null,
  role: "Senior Engineer",
  roles: ["Senior Engineer"],
  employmentType: "full-time",
  locationDisplay: "Remote",
  locations: [],
  remote: true,
  onsite: false,
  hybrid: false,
  remoteScope: "US",
  salaryText: null,
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: null,
  salaryPeriod: null,
  equity: false,
  applyMethod: "link",
  applyUrl: null,
  applyEmail: null,
  visa: false,
  intern: false,
  tags: [],
  parseConfidence: "parsed",
  roleFamilies: ["engineering"],
  roleSpecialties: [],
  seniority: "senior",
  locationRegions: ["north-america"],
  salaryBucket: "undisclosed",
  enrichmentStatus: "skipped",
  hidden: false,
  hiddenReason: null,
}

test("role text is rendered bold", () => {
  render(
    <table><tbody><JobRow job={baseJob} /></tbody></table>
  )
  const roleText = screen.getByText("Senior Engineer")
  expect(roleText).toBeTruthy()

  const el = roleText.closest("strong, b") ?? roleText
  const style = window.getComputedStyle(el)
  const isBoldByTag = el.tagName === "STRONG" || el.tagName === "B"
  const isBoldByStyle =
    style.fontWeight === "bold" ||
    style.fontWeight === "700" ||
    style.fontWeight === "800" ||
    style.fontWeight === "900" ||
    roleText.style.fontWeight === "bold" ||
    Number(roleText.style.fontWeight) >= 700
  const isBoldByClass = roleText.className.includes("bold") || el.className.includes("bold")

  expect(isBoldByTag || isBoldByStyle || isBoldByClass).toBe(true)
})

test("other columns still render (no structural breakage)", () => {
  render(
    <table><tbody><JobRow job={{ ...baseJob, applyUrl: "https://apply.com" }} /></tbody></table>
  )
  expect(screen.getByText("apply ↗")).toBeTruthy()
  expect(screen.getByText("Remote")).toBeTruthy()
  expect(screen.getByText("details")).toBeTruthy()
})
