import type { Meta, StoryObj } from "@storybook/react"
import { holdings } from "../data/holdings"
import { PortfolioView } from "./PortfolioView"

const meta: Meta<typeof PortfolioView> = {
  title: "views/PortfolioView",
  component: PortfolioView,
}

export default meta

type Story = StoryObj<typeof PortfolioView>

export const Default: Story = {
  args: {
    holdings,
  },
}

export const StocksOnly: Story = {
  args: {
    holdings,
    initialFilters: {
      searchQuery: "",
      assetClass: "Stock",
      sortMode: "gain",
    },
    selectedHoldingId: "hold-004",
  },
}

export const SearchFocused: Story = {
  args: {
    holdings,
    initialFilters: {
      searchQuery: "vanguard",
      assetClass: "All",
      sortMode: "symbol",
    },
    selectedHoldingId: "hold-001",
  },
}
