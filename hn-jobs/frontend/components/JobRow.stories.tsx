import type { Meta, StoryObj } from "@storybook/react"
import type { Job } from "../../shared/types"
import { JobRow } from "./JobRow"

// A fully-parsed posting; individual stories override the fields under test.
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

const meta: Meta<typeof JobRow> = {
  title: "directory/JobRow",
  component: JobRow,
  // JobRow renders a <tr>; wrap each story in a table so it lays out correctly.
  decorators: [(Story) => <table><tbody><Story /></tbody></table>],
}
export default meta

type Story = StoryObj<typeof JobRow>

// Salary shows "$180k", only first 4 of 5 tags render, company links out.
export const Default: Story = { args: { job: base } }

// Conditional hiring facts ("visa sponsorship", "interns welcome") appear.
export const VisaAndIntern: Story = {
  args: { job: { ...base, visa: true, intern: true } },
}

// Salary cell collapses to "—"; equity still annotates when present.
export const UndisclosedWithEquity: Story = {
  args: {
    job: { ...base, salaryText: null, salaryMin: null, salaryMax: null,
           salaryBucket: "undisclosed", equity: true },
  },
}

// Multiple roles stack as separate lines in the Role cell.
export const MultiRole: Story = {
  args: {
    job: { ...base, role: "Senior Engineer",
           roles: ["Senior Engineer", "Staff Engineer", "Eng Manager"] },
  },
}

// raw-only parse: company falls back to website host, conf-raw-only styling,
// most cells are "—".
export const RawOnly: Story = {
  args: {
    job: { ...base, company: null, role: null, roles: [], locationDisplay: null,
           salaryText: null, salaryMin: null, salaryMax: null, tags: [],
           parseConfidence: "raw-only" },
  },
}

// No apply link and no email: Apply cell is "—".
export const MissingApply: Story = {
  args: { job: { ...base, applyMethod: "hn-reply", applyUrl: null, applyEmail: null } },
}
