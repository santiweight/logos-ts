import type { Meta, StoryObj } from "@storybook/react-vite"
import { SidebarTree } from "./SidebarTree"
import type { FileEntry, TestState } from "./types"

const files: FileEntry[] = [
  {
    file: "src/components/JobCard.tsx",
    code: "export const JobCard = ...",
    items: [
      { kind: "function", name: "JobCard", signature: "JobCard(props: JobCardProps)", code: "", deps: [], tests: [] },
    ],
    component: {
      name: "JobCard",
      signature: "JobCard(props: JobCardProps)",
      componentCode: "export const JobCard = ...",
      propsName: "JobCardProps",
      propsCode: "interface JobCardProps { ... }",
      propsFields: [
        { name: "title", type: "string" },
        { name: "company", type: "string" },
      ],
      stories: [
        { id: "jobcard--default", exportName: "Default" },
        { id: "jobcard--remote", exportName: "Remote" },
      ],
      captured: [
        { exportName: "Default", testFile: "src/components/JobCard.Default.captured.test.tsx", snapshot: null },
      ],
    },
  },
  {
    file: "src/components/FiltersSidebar.tsx",
    code: "export const FiltersSidebar = ...",
    items: [
      { kind: "function", name: "FiltersSidebar", signature: "FiltersSidebar()", code: "", deps: [], tests: [] },
    ],
    component: {
      name: "FiltersSidebar",
      signature: "FiltersSidebar()",
      componentCode: "export const FiltersSidebar = ...",
      propsFields: [],
      stories: [
        { id: "filterssidebar--default", exportName: "Default" },
      ],
      captured: [],
    },
  },
  {
    file: "src/components/HeaderNav.tsx",
    code: "export const HeaderNav = ...",
    items: [
      { kind: "function", name: "HeaderNav", signature: "HeaderNav()", code: "", deps: [], tests: [] },
      { kind: "function", name: "NavLink", signature: "NavLink(props: NavLinkProps)", code: "", deps: [], tests: [] },
    ],
    component: {
      name: "HeaderNav",
      signature: "HeaderNav()",
      componentCode: "export const HeaderNav = ...",
      propsFields: [],
      stories: [
        { id: "headernav--default", exportName: "Default" },
      ],
      captured: [],
    },
  },
  {
    file: "backend/api/jobs.ts",
    code: "...",
    items: [
      { kind: "function", name: "parseJob", signature: "parseJob(raw: RawJob): Job", code: "", deps: [], tests: [] },
      { kind: "function", name: "fetchJobs", signature: "fetchJobs(): Promise<Job[]>", code: "", deps: [], tests: [] },
    ],
  },
  {
    file: "backend/models/JobStore.ts",
    code: "...",
    items: [
      { kind: "class", name: "JobStore", fields: [], methods: [], deps: [], tests: [], code: "" },
    ],
  },
  {
    file: "backend/utils/slug.ts",
    code: "...",
    items: [
      { kind: "function", name: "slugify", signature: "slugify(s: string): string", code: "", deps: [], tests: [{ name: "slugifies", file: "backend/utils/slug.test.ts", code: "" }] },
    ],
  },
]

const noop = () => {}

const meta: Meta<typeof SidebarTree> = {
  component: SidebarTree,
  decorators: [
    (Story) => (
      <div style={{ width: 260, height: "100vh", background: "var(--sidebar, #1b1b1f)", display: "flex", flexDirection: "column" }}>
        <Story />
      </div>
    ),
  ],
  args: {
    files,
    selection: { file: "src/components/JobCard.tsx", view: "code" },
    onSelect: noop,
    comments: {},
    onComment: noop,
    diff: {},
    testState: null,
  },
}
export default meta

type Story = StoryObj<typeof SidebarTree>

export const Default: Story = {}

export const WithDiff: Story = {
  args: {
    diff: {
      "fn:parseJob": "changed",
    },
  },
}

export const WithGoals: Story = {
  args: {
    comments: {
      "fn:parseJob": [
        { id: "g1", target: "fn:parseJob", label: "parseJob", text: "needs refactor", mode: "code", createdAt: 0, status: "pending" as const },
        { id: "g2", target: "fn:parseJob", label: "parseJob", text: "also fix types", mode: "arch", createdAt: 0, status: "done" as const },
      ],
    },
  },
}

export const WithTestResults: Story = {
  args: {
    testState: {
      status: "fail",
      results: {
        total: 5,
        passed: 4,
        failed: 1,
        failures: [{ test: "parses valid job", file: "backend/api/jobs.test.ts", message: "Expected..." }],
      },
      runningSince: null,
    } satisfies TestState,
  },
}

export const TestsRunning: Story = {
  args: {
    testState: {
      status: "running",
      results: { total: 5, passed: 3, failed: 0, failures: [] },
      runningSince: 1718100000000,
    } satisfies TestState,
  },
}
