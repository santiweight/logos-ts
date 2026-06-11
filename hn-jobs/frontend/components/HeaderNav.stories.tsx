import type { Meta, StoryObj } from "@storybook/react"
import { HeaderNav } from "./HeaderNav"

const meta: Meta<typeof HeaderNav> = {
  title: "components/HeaderNav",
  component: HeaderNav,
}
export default meta

type Story = StoryObj<typeof HeaderNav>

// Jobs link is active when on home or job detail page.
export const JobsActive: Story = {
  args: { pathname: "/" },
}

// Threads link is active when on threads page.
export const ThreadsActive: Story = {
  args: { pathname: "/threads" },
}

// Jobs is still active on job detail page.
export const JobDetailActive: Story = {
  args: { pathname: "/job/123" },
}
