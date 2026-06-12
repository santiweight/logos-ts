/* eslint-disable @typescript-eslint/no-non-null-assertion */
import type { Meta, StoryObj } from "@storybook/react"
import type { Job } from "../../shared/types"
import { DirectoryView } from "./DirectoryView"

const base: Job = {
  id: 101,
  hnCommentId: "39810",
  threadId: 1,
  author: "acmehq",
  postedAt: "2026-05-01T15:04:00Z",
  hnUrl: "https://news.ycombinator.com/item?id=39810",
  rawHtml: "<p>Acme | Senior Engineer | SF / Remote (US) | $180k</p>",
  rawText: "Acme | Senior Engineer | SF / Remote (US) | $180k",
  company: "Acme",
  websiteUrl: "https://acme.com",
  role: "Senior Engineer",
  roles: ["Senior Engineer"],
  employmentType: "full-time",
  locationDisplay: "SF / Remote (US)",
  locations: ["San Francisco, CA"],
  remote: true,
  onsite: false,
  hybrid: false,
  remoteScope: "US",
  salaryText: "$180k",
  salaryMin: 180000,
  salaryMax: null,
  salaryCurrency: "USD",
  salaryPeriod: "year",
  equity: false,
  applyMethod: "link",
  applyUrl: "https://acme.com/jobs",
  applyEmail: null,
  visa: false,
  intern: false,
  tags: ["TypeScript", "React", "Go", "Postgres", "AWS"],
  parseConfidence: "parsed",
  roleFamilies: ["engineering"],
  roleSpecialties: [],
  seniority: "senior",
  locationRegions: ["north-america"],
  salaryBucket: "disclosed",
  enrichmentStatus: "skipped",
  hidden: false,
  hiddenReason: null,
}

const meta: Meta<typeof DirectoryView> = {
  title: "views/DirectoryView",
  component: DirectoryView,
}
export default meta

type Story = StoryObj<typeof DirectoryView>

// Default directory with jobs and filter options.
export const Default: Story = {
  args: {
    jobs: [
      base,
      {
        ...base,
        id: 102,
        company: "TechCorp",
        role: "Staff Engineer",
        roles: ["Staff Engineer"],
        locationDisplay: "NYC (Remote optional)",
        salaryMin: 200000,
      },
    ],
    sortItems: [
      { label: "Company A–Z", href: "/?sort=company", active: false },
      { label: "Newest", href: "/?sort=newest", active: true },
      { label: "Salary high", href: "/?sort=salary-desc", active: false },
    ],
    flagItems: [
      { label: "Remote", href: "/?remote=1", active: false },
      { label: "Sponsors visa", href: "/?visa=1", active: false },
      { label: "Interns welcome", href: "/?intern=1", active: false },
    ],
    familyItems: [
      { label: "engineering", href: "/?family=engineering", count: 45, active: false },
      { label: "product", href: "/?family=product", count: 12, active: false },
    ],
    seniorityItems: [
      { label: "senior", href: "/?seniority=senior", count: 28, active: false },
      { label: "junior", href: "/?seniority=junior", count: 18, active: false },
    ],
    regionItems: [
      { label: "north-america", href: "/?region=north-america", count: 35, active: false },
      { label: "europe", href: "/?region=europe", count: 12, active: false },
    ],
    applyItems: [
      { label: "Link", href: "/?apply=link", count: 40, active: false },
      { label: "Email", href: "/?apply=email", count: 15, active: false },
    ],
    salaryItems: [
      { label: "Salary disclosed", href: "/?salary=disclosed", count: 52, active: false },
    ],
    tagItems: [
      { label: "TypeScript", href: "/?tag=TypeScript", count: 42, active: false },
      { label: "React", href: "/?tag=React", count: 28, active: false },
      { label: "Python", href: "/?tag=Python", count: 18, active: false },
    ],
    monthItems: [
      { label: "May 2026", href: "/?month=2026-05", count: 57, active: true },
      { label: "April 2026", href: "/?month=2026-04", count: 48, active: false },
    ],
    activeCount: 1,
    searchQuery: "",
  },
}

// Empty state: no jobs match.
export const Empty: Story = {
  args: {
    ...Default.args!,
    jobs: [],
  },
}

// With multiple active filters.
export const WithActiveFilters: Story = {
  args: {
    ...Default.args!,
    flagItems: [
      { label: "Remote", href: "/?remote=1", active: true },
      { label: "Sponsors visa", href: "/?visa=1", active: false },
      { label: "Interns welcome", href: "/?intern=1", active: true },
    ],
    activeCount: 3,
  },
}
