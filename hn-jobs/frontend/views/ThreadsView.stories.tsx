import type { Meta, StoryObj } from "@storybook/react"
import { ThreadsView } from "./ThreadsView"

const meta: Meta<typeof ThreadsView> = {
  title: "views/ThreadsView",
  component: ThreadsView,
}
export default meta

type Story = StoryObj<typeof ThreadsView>

// Multiple threads in reverse chronological order.
export const Default: Story = {
  args: {
    threads: [
      {
        id: 1,
        hnId: "40123456",
        title: "Ask HN: Who is hiring? (May 2026)",
        month: "2026-05",
        postedAt: "2026-05-01T10:00:00Z",
        jobCount: 57,
        lastIngestedAt: "2026-05-02T10:30:00Z",
      },
      {
        id: 2,
        hnId: "40456789",
        title: "Ask HN: Who is hiring? (April 2026)",
        month: "2026-04",
        postedAt: "2026-04-01T10:00:00Z",
        jobCount: 48,
        lastIngestedAt: "2026-04-02T09:15:00Z",
      },
      {
        id: 3,
        hnId: "40789123",
        title: "Ask HN: Who is hiring? (March 2026)",
        month: "2026-03",
        postedAt: "2026-03-01T10:00:00Z",
        jobCount: 52,
        lastIngestedAt: "2026-03-02T08:45:00Z",
      },
    ],
  },
}

// Empty state: no threads.
export const Empty: Story = {
  args: {
    threads: [],
  },
}

// Single thread.
export const Single: Story = {
  args: {
    threads: [
      {
        id: 1,
        hnId: "40123456",
        title: "Ask HN: Who is hiring? (May 2026)",
        month: "2026-05",
        postedAt: "2026-05-01T10:00:00Z",
        jobCount: 57,
        lastIngestedAt: "2026-05-02T10:30:00Z",
      },
    ],
  },
}
