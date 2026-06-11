import type { Meta, StoryObj } from "@storybook/react-vite"
import { ContentPanel } from "./ContentPanel"
import type { ComponentEntry } from "./types"

const component: ComponentEntry = {
  name: "JobCard",
  file: "src/components/JobCard.tsx",
  storiesFile: "src/components/JobCard.stories.tsx",
  signature: "JobCard(props: JobCardProps)",
  componentCode: `export const JobCard: FC<JobCardProps> = ({ title, company, remote, tags, postedAt }) => {
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
  propsName: "JobCardProps",
  propsCode: `interface JobCardProps {
  title: string
  company: string
  remote?: boolean
  tags: string[]
  postedAt: number
}`,
  propsFields: [
    { name: "title", type: "string" },
    { name: "company", type: "string" },
    { name: "remote?", type: "boolean" },
    { name: "tags", type: "string[]" },
    { name: "postedAt", type: "number" },
  ],
  deps: ["formatDate", "Badge", "Chip"],
  stories: [
    { id: "jobcard--default", exportName: "Default" },
    { id: "jobcard--remote", exportName: "Remote" },
  ],
  captured: [
    { exportName: "Default", testFile: "src/components/JobCard.Default.captured.test.tsx", snapshot: '<article class="job-card"><header><h3>Senior Engineer</h3><span class="company">Acme</span></header></article>' },
  ],
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
    component,
    selection: { comp: "JobCard", view: "code" },
    storybookUrl: "",
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
    selection: { comp: "JobCard", view: "captured", exportName: "Default" },
  },
}

export const StoryView: Story = {
  args: {
    selection: { comp: "JobCard", view: "story", storyId: "jobcard--default" },
    storybookUrl: "http://localhost:6006",
  },
}

export const WithDiff: Story = {
  args: {
    diff: { "component:JobCard": "changed", "props:JobCardProps": "changed" },
  },
}

export const WithComments: Story = {
  args: {
    comments: {
      "component:JobCard": [
        { id: "c1", target: "component:JobCard", label: "<JobCard/>", text: "Add loading skeleton", workspaceId: "ws-1", mode: "code", createdAt: 0 },
      ],
    },
  },
}
