import type { JobFilterable } from "./lib/job-filters";

export function job(overrides: Partial<JobFilterable> = {}): JobFilterable {
  return {
    company: "Acme",
    role: "Backend Engineer",
    rawText: "Acme is hiring backend engineers for distributed systems.",
    author: "whoishiring",
    locationDisplay: "Remote (US)",
    locationRegions: JSON.stringify(["north-america", "us"]),
    websiteUrl: "https://acme.com",
    tags: JSON.stringify(["Go", "PostgreSQL", "TypeScript"]),
    roleFamilies: JSON.stringify(["engineering", "backend"]),
    seniority: "Senior",
    salaryBucket: "disclosed",
    salaryMin: 140000,
    salaryMax: 180000,
    applyMethod: "link",
    applyUrl: "https://acme.com/careers",
    applyEmail: null,
    remote: true,
    visa: false,
    intern: false,
    postedAt: new Date(),
    ...overrides,
  };
}
