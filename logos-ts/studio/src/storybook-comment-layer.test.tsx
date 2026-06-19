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
  const mock = Reflect.get(window.parent, "postMessage") as unknown as { mock: { calls: Array<[unknown]> } }
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
    expect(messages.find((message) => message["type"] === "logos:story-comment")).toMatchObject({
      label: "button \"Apply\"",
      htmlContext: expect.stringContaining("selected: <button"),
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

  it("moves a draft popover visually without changing the attached selector", async () => {
    vi.spyOn(window.parent, "postMessage").mockImplementation(() => {})

    render(
      <StorybookCommentLayer storyId="jobcard--default" component="JobCard">
        <section>
          <button type="button">Apply</button>
        </section>
      </StorybookCommentLayer>
    )

    fireEvent.click(screen.getByRole("button", { name: "Apply" }), { altKey: true })

    const handle = screen.getByTitle("Drag comment")
    const popover = handle.parentElement
    if (!popover) throw new Error("Expected comment popover to contain the drag handle")
    expect(popover).toHaveStyle({ left: "12px", top: "8px" })

    fireEvent.pointerDown(handle, { button: 0, clientX: 10, clientY: 20, pointerId: 1 })
    fireEvent.pointerMove(window, { clientX: 70, clientY: 50, pointerId: 1 })
    fireEvent.pointerUp(window, { pointerId: 1 })

    await waitFor(() => {
      expect(popover).toHaveStyle({ left: "72px", top: "38px" })
    })

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Move only the box" } })
    fireEvent.click(screen.getByRole("button", { name: "Comment" }))

    await waitFor(() => {
      expect(lastPosted("logos:story-comment")).toMatchObject({
        storyId: "jobcard--default",
        component: "JobCard",
        selector: ":scope > section > button",
        text: "Move only the box",
      })
    })
  })
})
