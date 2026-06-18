import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { StorybookCommentLayer } from "./storybook-comment-layer"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  Object.defineProperty(window, "parent", { value: window, configurable: true })
})

beforeEach(() => {
  class TestResizeObserver {
    observe() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", TestResizeObserver)
})

function lastPosted(type: string): Record<string, unknown> | undefined {
  const mock = vi.mocked(window.parent.postMessage)
  const calls = mock.mock.calls.map(([message]) => message as Record<string, unknown>)
  return calls.reverse().find((message) => message["type"] === type)
}

describe("StorybookCommentLayer", () => {
  it("emits one story comment for one submit when nested in a frame", async () => {
    const messages: Record<string, unknown>[] = []
    const parent = {
      postMessage: vi.fn((message: unknown) => {
        messages.push(message as Record<string, unknown>)
      }),
    }
    Object.defineProperty(window, "parent", { value: parent, configurable: true })
    vi.spyOn(window, "postMessage").mockImplementation((message: unknown) => {
      messages.push(message as Record<string, unknown>)
    })

    render(
      <StorybookCommentLayer storyId="jobcard--default" component="JobCard">
        <section>
          <button type="button">Apply</button>
        </section>
      </StorybookCommentLayer>
    )

    fireEvent.click(screen.getByRole("button", { name: "Apply" }), { altKey: true })
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Make this clearer" } })
    fireEvent.click(screen.getByRole("button", { name: "Comment" }))

    await waitFor(() => {
      expect(messages.filter((message) => message["type"] === "logos:story-comment")).toHaveLength(1)
    })
  })

  it("restores an in-progress draft sent back from Studio after an iframe reload", async () => {
    vi.spyOn(window.parent, "postMessage").mockImplementation(() => {})

    render(
      <StorybookCommentLayer storyId="jobcard--default" component="JobCard">
        <section>
          <button type="button">Apply</button>
        </section>
      </StorybookCommentLayer>
    )

    window.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "logos:story-goals",
        goals: [],
        workspaceKind: "code",
        drafts: [{
          storyId: "jobcard--default",
          selector: ":scope > section > button",
          label: "button Apply",
          text: "Keep this text",
          mode: "code",
          fork: false,
          kind: "new",
        }],
      },
    }))

    await waitFor(() => {
      expect(screen.getByRole("textbox")).toHaveValue("Keep this text")
    })
  })

  it("attaches a submitted draft to the nearest surviving parent when the exact target disappears", async () => {
    vi.spyOn(window.parent, "postMessage").mockImplementation(() => {})

    const { rerender } = render(
      <StorybookCommentLayer storyId="jobcard--default" component="JobCard">
        <section>
          <button type="button">Apply</button>
        </section>
      </StorybookCommentLayer>
    )

    fireEvent.click(screen.getByRole("button", { name: "Apply" }), { altKey: true })
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Do not lose me" } })

    rerender(
      <StorybookCommentLayer storyId="jobcard--default" component="JobCard">
        <section>Parent still exists</section>
      </StorybookCommentLayer>
    )

    fireEvent.click(screen.getByRole("button", { name: "Comment" }))

    await waitFor(() => {
      expect(lastPosted("logos:story-comment")).toMatchObject({
        storyId: "jobcard--default",
        component: "JobCard",
        selector: ":scope > section",
        text: "Do not lose me",
      })
    })
  })
})
