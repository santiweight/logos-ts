import type { Preview } from "@storybook/react-vite"
import { StorybookCommentLayer } from "../src/storybook-comment-layer"
import "../src/studio.css"

const preview: Preview = {
  parameters: {
    backgrounds: {
      default: "dark",
      values: [{ name: "dark", value: "#1f1f23" }],
    },
  },
  decorators: [
    (Story, context) => (
      <div style={{ background: "#1f1f23", color: "#d4d4d8", minHeight: "100vh" }}>
        <StorybookCommentLayer storyId={context.id} component={context.title?.split("/").pop()}>
          <Story />
        </StorybookCommentLayer>
      </div>
    ),
  ],
}

export default preview
