import type { Meta, StoryObj } from "@storybook/react-vite"
import { ContentPanel } from "./ContentPanel"
import type { FileEntry } from "./types"

const file: FileEntry = {
  file: "src/components/JobCard.tsx",
  code: `export const JobCard: FC<JobCardProps> = ({ title, company, remote, tags, postedAt }) => {
  const formatted = formatDate(postedAt)
  return (
    <article className="job-card">
      <header>
        <h3>{title}</h3>
        <span className="company">{company}</span>
        {remote && <Badge label="remote" />}
      </header>
      <div className="tags">
        {tags.map(t => <Chip key={t} label={t} />)}
      </div>
      <time>{formatted}</time>
    </article>
  )
}`,
  items: [
    { kind: "function", name: "JobCard", signature: "JobCard(props: JobCardProps)", code: "", deps: [], tests: [] },
  ],
  component: {
    name: "JobCard",
    signature: "JobCard(props: JobCardProps)",
    componentCode: `export const JobCard: FC<JobCardProps> = ({ title, company }) => <article>{title}</article>`,
    propsName: "JobCardProps",
    propsCode: `interface JobCardProps { title: string; company: string; remote?: boolean; tags: string[]; postedAt: number }`,
    propsFields: [
      { name: "title", type: "string" },
      { name: "company", type: "string" },
      { name: "remote?", type: "boolean" },
      { name: "tags", type: "string[]" },
      { name: "postedAt", type: "number" },
    ],
    stories: [
      { id: "jobcard--default", exportName: "Default" },
      { id: "jobcard--remote", exportName: "Remote" },
    ],
    captured: [
      { exportName: "Default", testFile: "src/components/JobCard.Default.captured.test.tsx", snapshot: '<article class="job-card"><header><h3>Senior Engineer</h3></header></article>', previousSnapshot: null },
    ],
  },
}

const noop = () => {}

const meta: Meta<typeof ContentPanel> = {
  component: ContentPanel,
  decorators: [
    (Story) => (
      <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
        <Story />
      </div>
    ),
  ],
  args: {
    file,
    selection: { file: "src/components/JobCard.tsx", view: "code" },
    workspaceId: "ws-story",
    storyRenderer: "portable",
    storybookUrl: "",
    storybookState: null,
    storybookRenderKey: "story-render-key",
    onView: noop,
    onCapture: noop,
    comments: {},
    onComment: noop,
    diff: {},
  },
}
export default meta

type Story = StoryObj<typeof ContentPanel>

export const CodeView: Story = {}

export const CapturedView: Story = {
  args: {
    selection: { file: "src/components/JobCard.tsx", view: "captured", exportName: "Default" },
  },
}

export const StoryView: Story = {
  args: {
    selection: { file: "src/components/JobCard.tsx", view: "story", storyId: "jobcard--default" },
    storybookUrl: "http://localhost:6006",
  },
}

export const StoryViewStarting: Story = {
  args: {
    selection: { file: "src/components/JobCard.tsx", view: "story", storyId: "jobcard--default" },
    storybookUrl: "",
    storybookState: {
      status: "starting",
      startedAt: Date.now() - 5000,
      logs: [
        "@storybook/react-vite v8.6.14",
        "",
        "info Compiling preview...",
        "info Writing static files...",
        "info => Loading presets",
      ],
    },
  },
}

export const StoryViewFailed: Story = {
  args: {
    selection: { file: "src/components/JobCard.tsx", view: "story", storyId: "jobcard--default" },
    storybookUrl: "",
    storybookState: {
      status: "failed",
      startedAt: Date.now() - 12000,
      logs: [
        "@storybook/react-vite v8.6.14",
        "ERR! Cannot find module '@storybook/react-vite/preset'",
        "ERR! Require stack:",
        "ERR!   - /project/node_modules/@storybook/core/dist/index.js",
      ],
      error: "exited with code 1",
    },
  },
}

export const WithDiff: Story = {
  args: {
    diff: { "component:JobCard": "changed", "props:JobCardProps": "changed" },
  },
}

export const WithGoals: Story = {
  args: {
    comments: {
      "component:JobCard": [
        { id: "g1", target: "component:JobCard", label: "<JobCard/>", text: "Add loading skeleton", mode: "code", createdAt: 0, status: "pending" as const },
      ],
    },
  },
}
