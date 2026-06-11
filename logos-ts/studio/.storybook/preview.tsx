import type { Preview } from "@storybook/react-vite"
import "../src/studio.css"

const preview: Preview = {
  parameters: {
    backgrounds: {
      default: "dark",
      values: [{ name: "dark", value: "#1f1f23" }],
    },
  },
  decorators: [
    (Story) => (
      <div style={{ background: "#1f1f23", color: "#d4d4d8", minHeight: "100vh" }}>
        <Story />
      </div>
    ),
  ],
}
export default preview
