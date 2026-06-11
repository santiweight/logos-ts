import type { Meta, StoryObj } from "@storybook/react"
import type { Job } from "../../shared/types"
import { FactTable } from "./FactTable"

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

const meta: Meta<typeof FactTable> = {
  title: "components/FactTable",
  component: FactTable,
}
export default meta

type Story = StoryObj<typeof FactTable>

// Complete job with all fact rows visible.
export const Complete: Story = {
  args: { job: base },
}

// Job with multiple roles, specialties, visa sponsorship, and equity.
export const MultiRoleWithEquity: Story = {
  args: {
    job: {
      ...base,
      roles: ["Senior Engineer", "Staff Engineer"],
      roleSpecialties: ["Backend", "Distributed Systems"],
      equity: true,
      visa: true,
      intern: true,
    },
  },
}

// Minimal job: most facts are empty, shows dashes.
export const Minimal: Story = {
  args: {
    job: {
      ...base,
      company: null,
      websiteUrl: null,
      role: null,
      roles: [],
      employmentType: null,
      roleFamilies: [],
      seniority: null,
      roleSpecialties: [],
      locations: [],
      locationRegions: [],
      salaryMin: null,
      salaryMax: null,
      salaryText: null,
      tags: [],
      visa: false,
      intern: false,
    },
  },
}

// Hybrid location without "hybrid" in the display text; pill should appear.
export const HybridPill: Story = {
  args: {
    job: {
      ...base,
      hybrid: true,
      locationDisplay: "San Francisco, CA",
    },
  },
}

// Email apply method.
export const EmailApply: Story = {
  args: {
    job: {
      ...base,
      applyMethod: "email",
      applyUrl: null,
      applyEmail: "jobs@acme.com",
    },
  },
}
