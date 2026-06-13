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
    stories: [{ id: "jobcard--default", exportName: "Default" }],
    captured: [],
  },
}

function renderStory(storybookRenderKey: string) {
  return render(
    <ContentPanel
      file={file}
      selection={{ file: file.file, view: "story", storyId: "jobcard--default" }}
      workspaceId="ws-1"
      storyRenderer="storybook"
      storybookUrl="/storybooks/ws-1"
      storybookState={{ status: "ready", startedAt: 1000, logs: [] }}
      storybookRenderKey={storybookRenderKey}
      onRetryStorybook={() => {}}
      onView={() => {}}
      onCapture={() => {}}
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
        onView={() => {}}
        onCapture={() => {}}
        comments={{}}
        onComment={() => {}}
        diff={{}}
      />
    )

    expect(screen.getByTitle("jobcard--default")).toHaveAttribute(
      "src",
      "/portable-story.html?storyId=jobcard--default&logosReload=inst-1%3A1000&workspaceId=ws-1"
    )
  })

  it("changes the Storybook iframe URL when the workspace render key changes", () => {
    const { rerender } = renderStory("inst-1:1000")
    const iframe = screen.getByTitle("jobcard--default")
    expect(iframe).toHaveAttribute(
      "src",
      "/storybooks/ws-1/iframe.html?id=jobcard--default&viewMode=story&logosReload=inst-1%3A1000"
    )

    rerender(
      <ContentPanel
        file={file}
        selection={{ file: file.file, view: "story", storyId: "jobcard--default" }}
        workspaceId="ws-1"
        storyRenderer="storybook"
        storybookUrl="/storybooks/ws-1"
        storybookState={{ status: "ready", startedAt: 2000, logs: [] }}
        storybookRenderKey="inst-2:2000"
        onRetryStorybook={() => {}}
        onView={() => {}}
        onCapture={() => {}}
        comments={{}}
        onComment={() => {}}
        diff={{}}
      />
    )

    expect(screen.getByTitle("jobcard--default")).toHaveAttribute(
      "src",
      "/storybooks/ws-1/iframe.html?id=jobcard--default&viewMode=story&logosReload=inst-2%3A2000"
    )
  })
})
