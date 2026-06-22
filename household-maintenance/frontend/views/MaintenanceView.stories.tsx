import type { Meta, StoryObj } from "@storybook/react"
import { tasks } from "../data/tasks"
import { MaintenanceView } from "./MaintenanceView"

const meta: Meta<typeof MaintenanceView> = {
  title: "views/MaintenanceView",
  component: MaintenanceView,
}

export default meta

type Story = StoryObj<typeof MaintenanceView>

export const Default: Story = {
  args: {
    tasks,
  },
}

export const CriticalBacklog: Story = {
  args: {
    tasks,
    initialFilters: {
      searchQuery: "",
      zone: "All",
      status: "Overdue",
      sortMode: "priority",
    },
    selectedTaskId: "task-002",
  },
}

export const BasementZone: Story = {
  args: {
    tasks,
    initialFilters: {
      searchQuery: "",
      zone: "Basement",
      status: "All",
      sortMode: "due",
    },
  },
}

export const EmptySearch: Story = {
  args: {
    tasks,
    initialFilters: {
      searchQuery: "pool heater",
      zone: "All",
      status: "All",
      sortMode: "due",
    },
  },
}

export const EmptyQueue: Story = {
  args: {
    tasks: [],
  },
}

export const InvalidEmbeddedState: Story = {
  args: {
    tasks,
    initialFilters: {
      searchQuery: "",
      zone: "Attic",
      status: "Deferred" as never,
      sortMode: "due",
    },
    selectedTaskId: "missing-task",
  },
}
