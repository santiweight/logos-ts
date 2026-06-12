/* eslint-disable no-restricted-syntax */
import type { Meta, StoryObj } from "@storybook/react"
import { ValueOrDash } from "./ValueOrDash"

const meta: Meta<typeof ValueOrDash> = {
  title: "components/ValueOrDash",
  component: ValueOrDash,
}
export default meta

type Story = StoryObj<typeof ValueOrDash>

// Renders a string value normally.
export const WithValue: Story = {
  args: { value: "San Francisco, CA" },
}

// null → renders muted dash.
export const Null: Story = {
  args: { value: null },
}

// undefined → renders muted dash.
export const Undefined: Story = {
  args: { value: undefined },
}

// Empty string → renders muted dash.
export const Empty: Story = {
  args: { value: "" },
}
