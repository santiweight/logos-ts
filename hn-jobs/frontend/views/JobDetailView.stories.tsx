import type { Meta, StoryObj } from "@storybook/react"
import type { Job } from "../../shared/types"
import { JobDetailView } from "./JobDetailView"

const base: Job = {
  id: 101,
  hnCommentId: "39810",
  threadId: 1,
  author: "acmehq",
  postedAt: "2026-05-01T15:04:00Z",
  hnUrl: "https://news.ycombinator.com/item?id=39810",
  rawHtml: "<p>Acme | Senior Engineer | SF / Remote (US) | $180k</p>",
  rawText: "Acme | Senior Engineer | SF / Remote (US) | $180k\n\nWe are hiring senior engineers for our backend team. Experience with TypeScript, React, and distributed systems required.",
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

const meta: Meta<typeof JobDetailView> = {
  title: "views/JobDetailView",
  component: JobDetailView,
}
export default meta

type Story = StoryObj<typeof JobDetailView>

// Fully-parsed job with thread month in breadcrumbs.
export const Default: Story = {
  args: {
    job: base,
    threadMonth: "2026-05",
  },
}

// Raw-only parse: shows warning in header.
export const RawOnly: Story = {
  args: {
    job: {
      ...base,
      company: null,
      role: null,
      roles: [],
      locationDisplay: null,
      salaryText: null,
      salaryMin: null,
      salaryMax: null,
      tags: [],
      parseConfidence: "raw-only",
    },
    threadMonth: "2026-05",
  },
}

// Without thread month (no month link in breadcrumbs).
export const NoThreadMonth: Story = {
  args: {
    job: base,
    threadMonth: undefined,
  },
}
