import React from "react"
import type { Preview } from "@storybook/react"
import { CommentLayer } from "./CommentLayer"
import "../globals.css"

if (typeof window !== "undefined") {
  let snapshotHtml: string | null = null
  const applySnapshot = () => {
    if (!snapshotHtml) return
    const root = document.getElementById("storybook-root")
    if (root) {
      root.innerHTML = snapshotHtml
      root.style.display = "block"
    }
    document.body.classList.add("sb-show-main", "sb-main-padded")
    document.body.classList.remove("sb-show-nopreview", "sb-show-preparing")
  }
  window.addEventListener("message", (e) => {
    if (e.data?.type !== "logos:render-snapshot") return
    snapshotHtml = e.data.html ?? ""
    applySnapshot()
    window.parent?.postMessage({ type: "logos:snapshot-rendered" }, "*")
  })
  setInterval(() => {
    if (snapshotHtml && document.body.classList.contains("sb-show-nopreview")) applySnapshot()
  }, 200)
}

const preview: Preview = {
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story, context) => (
      <CommentLayer storyId={context.id} component={context.title?.split("/").pop()}>
        <Story />
      </CommentLayer>
    ),
  ],
}

export default preview
