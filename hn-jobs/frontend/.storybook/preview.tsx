import React from "react"
import type { Preview } from "@storybook/react"
import { CommentLayer } from "./CommentLayer"
import "../globals.css"

const preview: Preview = {
  parameters: {
    layout: "fullscreen",
  },
  // Every story gets element-pinned comments: hold Alt to highlight an element,
  // Alt+click to pin a comment. See ./CommentLayer.tsx.
  decorators: [
    (Story, context) => (
      <CommentLayer storyId={context.id} component={context.title?.split("/").pop()}>
        <Story />
      </CommentLayer>
    ),
  ],
}

export default preview
