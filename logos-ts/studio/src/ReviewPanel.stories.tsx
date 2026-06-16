import type { Meta, StoryObj } from "@storybook/react-vite"
import { ReviewPanel } from "./ReviewPanel"
import type { StudioIndex } from "./types"

const before = '<article class="job-card"><h3>Senior Engineer</h3><span>New York</span></article>'
const after = '<article class="job-card"><h3>Senior Platform Engineer</h3><span>New York / Remote</span></article>'

function makeIndex(snapshot: string): StudioIndex {
  return {
    root: "/demo",
    files: [{
      file: "components/JobCard.tsx",
      code: "",
      items: [],
      component: {
        name: "JobCard",
        signature: "JobCard(props: JobCardProps)",
        componentCode: "export function JobCard() {}",
        propsName: "JobCardProps",
        propsCode: "interface JobCardProps { title: string }",
        propsFields: [{ name: "title", type: "string" }],
        stories: [{ id: "jobcard--default", exportName: "Default", snapshot }],
      },
    }],
  }
}

const meta: Meta<typeof ReviewPanel> = {
  component: ReviewPanel,
  decorators: [
    (Story) => <div style={{ height: "100vh" }}><Story /></div>,
  ],
  args: {
    base: makeIndex(before),
    workspace: makeIndex(after),
    storybookUrl: "",
    storybookState: null,
    onRetryStorybook: () => {},
  },
}
export default meta

type Story = StoryObj<typeof ReviewPanel>

export const ChangedCapture: Story = {}
