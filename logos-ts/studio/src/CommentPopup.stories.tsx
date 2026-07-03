import type { Meta, StoryObj } from "@storybook/react-vite"
import type { Goal } from "./types"
import { CommentPopup } from "./CommentPopup"

const meta: Meta<typeof CommentPopup> = {
  title: "studio/CommentPopup",
  component: CommentPopup,
}
export default meta

type Story = StoryObj<typeof CommentPopup>

const noop = () => {}

const goal1: Goal = {
  id: "g-1",
  target: "fn:buildStudioIndex",
  label: "buildStudioIndex",
  text: "Switch to the unified FileEntry model here",
  mode: "code",
  createdAt: Date.now() - 180_000,
  status: "done",
}

const goal2: Goal = {
  id: "g-2",
  target: "fn:buildStudioIndex",
  label: "buildStudioIndex",
  text: "Flatten the two-bucket model into files[]",
  mode: "code",
  createdAt: Date.now() - 60_000,
  status: "done",
}

export const NewGoal: Story = {
  args: {
    x: 200,
    y: 120,
    label: "buildStudioIndex",
    goals: [],
    onAdd: noop,
    onClose: noop,
  },
}

export const WithThread: Story = {
  args: {
    x: 200,
    y: 120,
    label: "buildStudioIndex",
    goals: [goal1],
    onAdd: noop,
    onClose: noop,
  },
}

export const WithMultipleGoals: Story = {
  args: {
    x: 200,
    y: 120,
    label: "buildStudioIndex",
    goals: [goal1, goal2],
    onAdd: noop,
    onClose: noop,
  },
}
