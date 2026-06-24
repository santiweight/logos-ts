import type { Meta, StoryObj } from "@storybook/react-vite"
import { CommentThread, type CommentItem, popoverShell } from "./comment-ui"

const meta: Meta<typeof CommentThread> = {
  title: "studio/CommentThread",
  component: CommentThread,
  decorators: [
    (Story) => (
      <div style={{ ...popoverShell, position: "relative" }}>
        <Story />
      </div>
    ),
  ],
}
export default meta

type Story = StoryObj<typeof CommentThread>

const noop = () => {}

const BASE_TIME = 1_700_000_000_000

const comment1: CommentItem = {
  id: "c-1",
  text: "Switch to the unified FileEntry model here",
  author: "alice",
  createdAt: BASE_TIME - 180_000,
  agentId: "agent-42",
  agentStatus: "done",
  status: "done",
  mode: "code",
}

const comment2: CommentItem = {
  id: "c-2",
  text: "Flatten the two-bucket model into files[]",
  author: "bob",
  createdAt: BASE_TIME - 60_000,
  agentId: "agent-43",
  agentStatus: "pending",
  status: "pending",
  mode: "arch",
}

const commentWithReplies: CommentItem = {
  ...comment1,
  id: "c-3",
  replies: [
    { author: "agent", text: "Done — switched to FileEntry model in buildStudioIndex.", createdAt: BASE_TIME - 90_000 },
    { author: "user", text: "Looks good, thanks!", createdAt: BASE_TIME - 45_000 },
  ],
}

export const Empty: Story = {
  args: {
    label: "buildStudioIndex",
    comments: [],
    onAdd: noop,
    onClose: noop,
  },
}

export const SingleComment: Story = {
  args: {
    label: "buildStudioIndex",
    comments: [comment1],
    onAdd: noop,
    onRemove: noop,
    onClose: noop,
  },
}

export const MultipleComments: Story = {
  args: {
    label: "buildStudioIndex",
    comments: [comment1, comment2],
    onAdd: noop,
    onRemove: noop,
    onClose: noop,
  },
}

export const WithReplies: Story = {
  args: {
    label: "buildStudioIndex",
    comments: [commentWithReplies],
    onAdd: noop,
    onRemove: noop,
    onReply: noop,
    onClose: noop,
  },
}

export const ArchMode: Story = {
  args: {
    label: "App",
    comments: [],
    onAdd: noop,
    onClose: noop,
    workspaceKind: "arch",
    initialDraft: { mode: "arch" },
  },
}

export const LongContent: Story = {
  args: {
    label: "veryLongFunctionNameThatMightOverflow",
    comments: [
      {
        id: "c-long",
        text: "This is a very long comment that spans multiple lines to test how the thread handles overflow and wrapping. It contains detailed feedback about the implementation that the author wanted to share with the rest of the team before merging.",
        author: "carol",
        createdAt: BASE_TIME - 300_000,
        agentId: null,
        agentStatus: null,
        status: "done",
        mode: "code",
      },
    ],
    onAdd: noop,
    onRemove: noop,
    onClose: noop,
  },
}

export const WithInitialDraft: Story = {
  args: {
    label: "detectComponents",
    comments: [],
    onAdd: noop,
    onClose: noop,
    initialDraft: { text: "Consider memoizing this function", mode: "code", fork: true, autoMerge: false },
  },
}
