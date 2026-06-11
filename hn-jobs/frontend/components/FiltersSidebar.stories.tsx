import type { Meta, StoryObj } from "@storybook/react"
import { FiltersSidebar } from "./FiltersSidebar"
import { SearchableFilter, type FilterItem } from "./SearchableFilter"

const meta: Meta<typeof FiltersSidebar> = {
  title: "components/FiltersSidebar",
  component: FiltersSidebar,
}
export default meta

type Story = StoryObj<typeof FiltersSidebar>

const sampleFilters: FilterItem[] = [
  { label: "TypeScript", href: "/?tag=TypeScript", count: 142 },
  { label: "React", href: "/?tag=React", count: 98 },
  { label: "Python", href: "/?tag=Python", count: 67 },
]

// No active filters; button shows "Filters ▼".
export const Closed: Story = {
  args: {
    activeCount: 0,
    children: (
      <>
        <SearchableFilter title="Tech" items={sampleFilters} />
      </>
    ),
  },
}

// Two active filters; button shows "Filters (2) ▼" and has a dot.
export const WithActiveFilters: Story = {
  args: {
    activeCount: 2,
    children: (
      <>
        <SearchableFilter title="Tech" items={sampleFilters} />
      </>
    ),
  },
}
