import type { Meta, StoryObj } from "@storybook/react-vite"
import { SidebarTree } from "./SidebarTree"
import type { BackendFile, ComponentEntry, Comment, TestState } from "./types"

const components: ComponentEntry[] = [
  {
    name: "JobCard",
    file: "src/components/JobCard.tsx",
    storiesFile: "src/components/JobCard.stories.tsx",
    signature: "JobCard(props: JobCardProps)",
    componentCode: "export const JobCard = ...",
    propsName: "JobCardProps",
    propsCode: "interface JobCardProps { ... }",
    propsFields: [
      { name: "title", type: "string" },
      { name: "company", type: "string" },
      { name: "remote?", type: "boolean" },
    ],
    deps: ["formatDate", "Badge"],
    stories: [
      { id: "jobcard--default", exportName: "Default" },
      { id: "jobcard--remote", exportName: "Remote" },
    ],
    captured: [
      { exportName: "Default", testFile: "src/components/JobCard.Default.captured.test.tsx", snapshot: null },
    ],
  },
  {
    name: "FilterBar",
    file: "src/components/FilterBar.tsx",
    storiesFile: "src/components/FilterBar.stories.tsx",
    signature: "FilterBar(props: FilterBarProps)",
    componentCode: "export const FilterBar = ...",
    propsName: "FilterBarProps",
    propsFields: [
      { name: "filters", type: "Filter[]" },
      { name: "onChange", type: "(f: Filter[]) => void" },
    ],
    deps: ["Chip", "useFilters"],
    stories: [{ id: "filterbar--default", exportName: "Default" }],
    captured: [],
  },
  {
    name: "Badge",
    file: "src/components/Badge.tsx",
    storiesFile: "src/components/Badge.stories.tsx",
    signature: "Badge(props: BadgeProps)",
    componentCode: "export const Badge = ...",
    propsFields: [{ name: "label", type: "string" }],
    deps: [],
    stories: [
      { id: "badge--default", exportName: "Default" },
      { id: "badge--accent", exportName: "Accent" },
      { id: "badge--muted", exportName: "Muted" },
    ],
    captured: [],
  },
]

const backend: BackendFile[] = [
  {
    file: "backend/api/jobs.ts",
    code: "...",
    items: [
      { kind: "function", name: "parseJob", signature: "parseJob(raw: RawJob): Job", code: "...", deps: ["sanitize"], tests: [{ name: "parses valid job", file: "backend/api/jobs.test.ts", code: "..." }] },
      { kind: "function", name: "filterJobs", signature: "filterJobs(jobs: Job[], q: Query): Job[]", code: "...", deps: [], tests: [] },
    ],
  },
  {
    file: "backend/api/search.ts",
    code: "...",
    items: [
      { kind: "function", name: "searchIndex", signature: "searchIndex(q: string): Result[]", code: "...", deps: ["tokenize"], tests: [{ name: "returns matches", file: "backend/api/search.test.ts", code: "..." }] },
    ],
  },
  {
    file: "backend/models/JobStore.ts",
    code: "...",
    items: [
      { kind: "class", name: "JobStore", fields: [{ name: "jobs", type: "Job[]" }], methods: [{ name: "add", signature: "add(j: Job): void", code: "...", tests: [] }, { name: "find", signature: "find(id: string): Job | undefined", code: "...", tests: [{ name: "finds by id", file: "backend/models/JobStore.test.ts", code: "..." }] }], deps: ["Job"], tests: [{ name: "constructs empty", file: "backend/models/JobStore.test.ts", code: "..." }], code: "..." },
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
    components,
    backend,
    active: "component",
    selection: { comp: "JobCard", view: "code" },
    backendSel: null,
    onSelectComponent: noop,
    onSelectBackend: noop,
    comments: {},
    onComment: noop,
    diff: {},
    testState: null,
  },
}
export default meta

type Story = StoryObj<typeof SidebarTree>

export const Default: Story = {}

export const BackendSelected: Story = {
  args: {
    active: "backend",
    backendSel: { symbol: "parseJob" },
  },
}

export const WithDiff: Story = {
  args: {
    diff: {
      "fn:parseJob": "changed",
      "fn:filterJobs": "added",
      "component:Badge": "changed",
    },
  },
}

export const WithComments: Story = {
  args: {
    comments: {
      "fn:parseJob": [
        { id: "c1", target: "fn:parseJob", label: "parseJob", text: "needs refactor", workspaceId: "ws-1", mode: "code", createdAt: 0 },
        { id: "c2", target: "fn:parseJob", label: "parseJob", text: "also fix types", workspaceId: "ws-1", mode: "arch", createdAt: 0 },
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
