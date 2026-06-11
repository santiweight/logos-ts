import type { Meta, StoryObj } from "@storybook/react-vite"
import type { Comment } from "./types"
import { CommentPopup } from "./CommentPopup"

const meta: Meta<typeof CommentPopup> = {
  title: "studio/CommentPopup",
  component: CommentPopup,
}
export default meta

type Story = StoryObj<typeof CommentPopup>

const noop = () => {}

const existingComment: Comment = {
  id: "c-1",
  target: "fn:buildStudioIndex",
  label: "buildStudioIndex",
  text: "Switch to the unified FileEntry model here",
  workspaceId: "ws-1",
  mode: "code",
  createdAt: Date.now() - 180_000,
}

const agentComment: Comment = {
  id: "c-2",
  target: "fn:buildStudioIndex",
  label: "buildStudioIndex",
  text: "Flatten the two-bucket model into files[]",
  workspaceId: "ws-1",
  mode: "arch",
  createdAt: Date.now() - 60_000,
  agentId: "agent-7f3a",
  agentStatus: "done",
}

// Fresh popup with no existing comments — shows the composer.
export const NewComment: Story = {
  args: {
    x: 200,
    y: 120,
    label: "buildStudioIndex",
    comments: [],
    onAdd: noop,
    onClose: noop,
  },
}

// Popup showing an existing comment thread.
export const WithThread: Story = {
  args: {
    x: 200,
    y: 120,
    label: "buildStudioIndex",
    comments: [existingComment],
    onAdd: noop,
    onClose: noop,
  },
}

// Thread with an agent-assigned comment showing status badge.
export const WithAgentComment: Story = {
  args: {
    x: 200,
    y: 120,
    label: "buildStudioIndex",
    comments: [existingComment, agentComment],
    onAdd: noop,
    onClose: noop,
  },
}
