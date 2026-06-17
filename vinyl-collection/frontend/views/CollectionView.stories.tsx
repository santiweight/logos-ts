import type { Meta, StoryObj } from "@storybook/react"
import { records } from "../data/records"
import { CollectionView } from "./CollectionView"

const meta: Meta<typeof CollectionView> = {
  title: "views/CollectionView",
  component: CollectionView,
}

export default meta

type Story = StoryObj<typeof CollectionView>

export const Default: Story = {
  args: {
    records,
  },
}

export const EssentialsShelf: Story = {
  args: {
    records,
    initialFilters: {
      searchQuery: "",
      genre: "All",
      shelf: "Essentials",
      sortMode: "rating",
    },
    featuredRecordId: "rec-006",
  },
}

export const SearchFocused: Story = {
  args: {
    records,
    initialFilters: {
      searchQuery: "quiet",
      genre: "All",
      shelf: "All",
      sortMode: "recent",
    },
    featuredRecordId: "rec-003",
  },
}
