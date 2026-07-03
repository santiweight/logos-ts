import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { ContentPanel } from "./ContentPanel"
import type { FileEntry } from "./types"

afterEach(cleanup)

const file: FileEntry = {
  file: "components/JobCard.tsx",
  code: "",
  items: [],
  component: {
    name: "JobCard",
    signature: "JobCard()",
    componentCode: "",
    propsFields: [],
    stories: [{ id: "jobcard--default", exportName: "Default", snapshot: null }],
  },
}

function renderStory(storybookRenderKey: string, storyCommentEditingByStoryId: Record<string, boolean> = {}) {
  return render(
    <ContentPanel
      file={file}
      selection={{ file: file.file, view: "story", storyId: "jobcard--default" }}
      workspaceId="ws-1"
      storyRenderer="storybook"
      storybookUrl="http://127.0.0.1:6006"
      storybookState={{ status: "ready", startedAt: 1000, logs: [] }}
      storybookRenderKey={storybookRenderKey}
      storyCommentEditingByStoryId={storyCommentEditingByStoryId}
      onRetryStorybook={() => {}}
      comments={{}}
      onComment={() => {}}
      diff={{}}
    />
  )
}

describe("ContentPanel", () => {
  it("renders portable stories through the portable story frame", () => {
    render(
      <ContentPanel
        file={file}
        selection={{ file: file.file, view: "story", storyId: "jobcard--default" }}
        workspaceId="ws-1"
        storyRenderer="portable"
        storybookUrl=""
        storybookState={null}
        storybookRenderKey="inst-1:1000"
        onRetryStorybook={() => {}}
        comments={{}}
        onComment={() => {}}
        diff={{}}
      />
    )

    expect(screen.getByTitle("jobcard--default")).toHaveAttribute(
      "src",
      "/portable-story.html?storyId=jobcard--default&logosReload=inst-1%3A1000&workspaceId=ws-1"
    )
    expect(screen.getByRole("button", { name: "Refit preview" })).toBeTruthy()
    expect(screen.getByText("/components/JobCard/Default")).toBeTruthy()
    expect(screen.queryByText(/portable/i)).toBeNull()
    expect(screen.queryByText(/Storybook dev server/i)).toBeNull()
  })

  it("renders a component path header without content view tabs", () => {
    render(
      <ContentPanel
        file={file}
        selection={{ file: file.file, component: "JobCard", view: "code" }}
        workspaceId="ws-1"
        storyRenderer="portable"
        storybookUrl=""
        storybookState={null}
        storybookRenderKey="inst-1:1000"
        onRetryStorybook={() => {}}
        comments={{}}
        onComment={() => {}}
        diff={{}}
      />
    )

    expect(screen.getByText("/components/JobCard")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Code" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Arch" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Story" })).toBeNull()
  })

  it("changes the Storybook iframe URL when the workspace render key changes", () => {
    const { rerender } = renderStory("inst-1:1000")
    const iframe = screen.getByTitle("jobcard--default")
    expect(iframe).toHaveAttribute(
      "src",
      "http://127.0.0.1:6006/iframe.html?id=jobcard--default&viewMode=story&logosReload=inst-1%3A1000"
    )

    rerender(
      <ContentPanel
        file={file}
        selection={{ file: file.file, view: "story", storyId: "jobcard--default" }}
        workspaceId="ws-1"
        storyRenderer="storybook"
        storybookUrl="http://127.0.0.1:6006"
        storybookState={{ status: "ready", startedAt: 2000, logs: [] }}
        storybookRenderKey="inst-2:2000"
        storyCommentEditingByStoryId={{}}
        onRetryStorybook={() => {}}
        comments={{}}
        onComment={() => {}}
        diff={{}}
      />
    )

    expect(screen.getByTitle("jobcard--default")).toHaveAttribute(
      "src",
      "http://127.0.0.1:6006/iframe.html?id=jobcard--default&viewMode=story&logosReload=inst-2%3A2000"
    )
  })

  it("does not remount the iframe when storybookRenderKey changes", () => {
    const { rerender } = renderStory("inst-1:1000:0:0")
    const iframe = screen.getByTitle("jobcard--default")
    expect(iframe.tagName).toBe("IFRAME")

    rerender(
      <ContentPanel
        file={file}
        selection={{ file: file.file, view: "story", storyId: "jobcard--default" }}
        workspaceId="ws-1"
        storyRenderer="storybook"
        storybookUrl="http://127.0.0.1:6006"
        storybookState={{ status: "ready", startedAt: 1000, logs: [] }}
        storybookRenderKey="inst-1:1000:1:abc"
        storyCommentEditingByStoryId={{}}
        onRetryStorybook={() => {}}
        comments={{}}
        onComment={() => {}}
        diff={{}}
      />
    )

    const iframeAfter = screen.getByTitle("jobcard--default")
    expect(iframeAfter).toBe(iframe)
    expect(iframeAfter).toHaveAttribute(
      "src",
      "http://127.0.0.1:6006/iframe.html?id=jobcard--default&viewMode=story&logosReload=inst-1%3A1000%3A1%3Aabc"
    )
  })

  it("defers Storybook iframe URL changes while a story comment is being typed", () => {
    const { rerender } = renderStory("inst-1:1000")
    expect(screen.getByTitle("jobcard--default")).toHaveAttribute(
      "src",
      "http://127.0.0.1:6006/iframe.html?id=jobcard--default&viewMode=story&logosReload=inst-1%3A1000"
    )

    rerender(
      <ContentPanel
        file={file}
        selection={{ file: file.file, view: "story", storyId: "jobcard--default" }}
        workspaceId="ws-1"
        storyRenderer="storybook"
        storybookUrl="http://127.0.0.1:6006"
        storybookState={{ status: "ready", startedAt: 2000, logs: [] }}
        storybookRenderKey="inst-2:2000"
        storyCommentEditingByStoryId={{ "jobcard--default": true }}
        onRetryStorybook={() => {}}
        comments={{}}
        onComment={() => {}}
        diff={{}}
      />
    )

    expect(screen.getByTitle("jobcard--default")).toHaveAttribute(
      "src",
      "http://127.0.0.1:6006/iframe.html?id=jobcard--default&viewMode=story&logosReload=inst-1%3A1000"
    )

    rerender(
      <ContentPanel
        file={file}
        selection={{ file: file.file, view: "story", storyId: "jobcard--default" }}
        workspaceId="ws-1"
        storyRenderer="storybook"
        storybookUrl="http://127.0.0.1:6006"
        storybookState={{ status: "ready", startedAt: 2000, logs: [] }}
        storybookRenderKey="inst-2:2000"
        storyCommentEditingByStoryId={{}}
        onRetryStorybook={() => {}}
        comments={{}}
        onComment={() => {}}
        diff={{}}
      />
    )

    expect(screen.getByTitle("jobcard--default")).toHaveAttribute(
      "src",
      "http://127.0.0.1:6006/iframe.html?id=jobcard--default&viewMode=story&logosReload=inst-2%3A2000"
    )
  })
})
