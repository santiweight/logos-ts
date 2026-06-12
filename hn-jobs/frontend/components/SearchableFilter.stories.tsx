import type { Meta, StoryObj } from "@storybook/react"
import { SearchableFilter, type FilterItem } from "./SearchableFilter"

const meta: Meta<typeof SearchableFilter> = {
  title: "components/SearchableFilter",
  component: SearchableFilter,
}
export default meta

type Story = StoryObj<typeof SearchableFilter>

const baseItems: FilterItem[] = [
  { label: "TypeScript", href: "/?tag=TypeScript", count: 142, active: false },
  { label: "React", href: "/?tag=React", count: 98, active: false },
  { label: "Python", href: "/?tag=Python", count: 67, active: false },
  { label: "Go", href: "/?tag=Go", count: 54, active: false },
]

// Non-searchable filter with counts.
export const Basic: Story = {
  args: {
    title: "Tech",
    items: baseItems,
  },
}

// Searchable filter with many items and a clear link.
export const Searchable: Story = {
  args: {
    title: "Tech",
    items: baseItems,
    searchable: true,
    clearHref: "/",
  },
}

// One item is active; clear link shows.
export const WithActiveItem: Story = {
  args: {
    title: "Tech",
    items: [
      { label: "TypeScript", href: "/?tag=TypeScript", count: 142, active: false },
      { label: "React", href: "/?tag=React", count: 98, active: true },
      { label: "Python", href: "/?tag=Python", count: 67, active: false },
      { label: "Go", href: "/?tag=Go", count: 54, active: false },
    ],
    searchable: true,
    clearHref: "/",
  },
}

// Items without counts (flags like Remote, Visa).
export const NoCount: Story = {
  args: {
    title: "Filters",
    items: [
      { label: "Remote", href: "/?remote=1", active: false },
      { label: "Sponsors visa", href: "/?visa=1", active: false },
      { label: "Interns welcome", href: "/?intern=1", active: false },
    ],
  },
}
