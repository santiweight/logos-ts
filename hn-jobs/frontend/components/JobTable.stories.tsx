import type { Meta, StoryObj } from "@storybook/react"
import type { Job } from "../../shared/types"
import { JobTable } from "./JobTable"

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

const meta: Meta<typeof JobTable> = {
  title: "components/JobTable",
  component: JobTable,
}
export default meta

type Story = StoryObj<typeof JobTable>

// Renders multiple jobs in a table.
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
      {
        ...base,
        id: 103,
        company: "StartupXYZ",
        role: "Product Manager",
        roles: ["Product Manager"],
        locationDisplay: "Austin, TX",
        salaryMin: 140000,
      },
    ],
  },
}

// Empty job list shows the empty state message.
export const Empty: Story = {
  args: { jobs: [] },
}

// Single job in the table.
export const Single: Story = {
  args: { jobs: [base] },
}
