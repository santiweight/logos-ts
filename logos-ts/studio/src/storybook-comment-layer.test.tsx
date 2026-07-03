import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { StorybookCommentLayer } from "./storybook-comment-layer"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  Object.defineProperty(window, "parent", { value: window, configurable: true })
  delete (window as typeof window & { __LOGOS_STORY_COMMENT_LAYER_ACTIVE__?: string }).__LOGOS_STORY_COMMENT_LAYER_ACTIVE__
})

beforeEach(() => {
  class TestResizeObserver {
    observe() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", TestResizeObserver)
})

function postedMessages(type: string): Record<string, unknown>[] {
  const mock = Reflect.get(window.parent, "postMessage") as unknown as { mock: { calls: Array<[unknown]> } }
  return mock.mock.calls.map(([message]) => message as Record<string, unknown>).filter((m) => m["type"] === type)
}

function lastPosted(type: string): Record<string, unknown> | undefined {
  return postedMessages(type).at(-1)
}

describe("StorybookCommentLayer", () => {
  it("keeps only one active overlay when comment layers are nested", () => {
    Object.defineProperty(window, "parent", {
      value: { postMessage: vi.fn() },
      configurable: true,
    })

    render(
      <StorybookCommentLayer storyId="jobcard--default" component="JobCard">
        <StorybookCommentLayer storyId="jobcard--default" component="JobCard">
          <section>
            <button type="button">Apply</button>
          </section>
        </StorybookCommentLayer>
      </StorybookCommentLayer>
    )

    expect(screen.getAllByRole("button", { name: "Comments" })).toHaveLength(1)
  })

  it("posts popover-show with composer kind after alt-clicking an element", () => {
    Object.defineProperty(window, "parent", {
      value: { postMessage: vi.fn() },
      configurable: true,
    })

    render(
      <StorybookCommentLayer storyId="jobcard--default" component="JobCard">
        <section>
          <button type="button">Apply</button>
        </section>
      </StorybookCommentLayer>
    )

    fireEvent.click(screen.getByRole("button", { name: "Apply" }), { altKey: true })

    expect(lastPosted("logos:story-popover-show")).toMatchObject({
      storyId: "jobcard--default",
      component: "JobCard",
      kind: "composer",
      label: "button \"Apply\"",
    })
  })

  it("posts popover-show with thread kind after clicking a pin", async () => {
    vi.spyOn(window.parent, "postMessage").mockImplementation(() => {})

    render(
      <StorybookCommentLayer storyId="jobcard--default" component="JobCard">
        <section>
          <button type="button">Apply</button>
        </section>
      </StorybookCommentLayer>
    )

    fireEvent(
      window,
      new MessageEvent("message", {
        data: {
          type: "logos:story-goals",
          workspaceKind: "code",
          drafts: [],
          goals: [{
            id: "goal-1",
            storyId: "jobcard--default",
            selector: ":scope > section > button",
            label: "button \"Apply\"",
            text: "Make this clearer",
            author: "you",
            createdAt: 1000,
            component: "JobCard",
            status: "done",
            sessionId: "session-1",
          }],
        },
      }),
    )

    fireEvent.click(await screen.findByTitle("1 comment"))

    expect(lastPosted("logos:story-popover-show")).toMatchObject({
      kind: "thread",
      selector: ":scope > section > button",
    })
  })

  it("restores a draft and posts popover-show after studio sends draft data", async () => {
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
          kind: "new",
        }],
      },
    }))

    await waitFor(() => {
      expect(lastPosted("logos:story-popover-show")).toMatchObject({
        kind: "composer",
        selector: ":scope > section > button",
        label: "button Apply",
      })
    })
  })

  it("opens a screenshot-backed draft after Alt-drag drawing", async () => {
    vi.spyOn(window.parent, "postMessage").mockImplementation(() => {})
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      scale: vi.fn(),
      set lineCap(_value: string) {},
      set lineJoin(_value: string) {},
      set lineWidth(_value: number) {},
      set strokeStyle(_value: string) {},
    } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,ZmFrZQ==")

    render(
      <StorybookCommentLayer storyId="jobcard--default" component="JobCard">
        <section>
          <button type="button">Apply</button>
        </section>
      </StorybookCommentLayer>
    )

    const button = screen.getByRole("button", { name: "Apply" })
    fireEvent.mouseDown(button, { altKey: true, button: 0, clientX: 10, clientY: 10 })
    fireEvent.mouseMove(document, { clientX: 50, clientY: 60 })
    fireEvent.mouseUp(document, { clientX: 50, clientY: 60 })

    await waitFor(() => {
      expect(lastPosted("logos:story-popover-show")).toMatchObject({
        kind: "composer",
        storyId: "jobcard--default",
        selector: ":scope > section > button",
        screenshotDataUrl: "data:image/png;base64,ZmFrZQ==",
        htmlContext: expect.stringContaining("annotation: Alt-drag drawing"),
      })
    })
  })

  it("hides popover when pin is clicked again", async () => {
    vi.spyOn(window.parent, "postMessage").mockImplementation(() => {})

    render(
      <StorybookCommentLayer storyId="jobcard--default" component="JobCard">
        <section>
          <button type="button">Apply</button>
        </section>
      </StorybookCommentLayer>
    )

    fireEvent(
      window,
      new MessageEvent("message", {
        data: {
          type: "logos:story-goals",
          workspaceKind: "code",
          drafts: [],
          goals: [{
            id: "goal-1",
            storyId: "jobcard--default",
            selector: ":scope > section > button",
            label: "button \"Apply\"",
            text: "Test",
            author: "you",
            createdAt: 1000,
          }],
        },
      }),
    )

    const pin = await screen.findByTitle("1 comment")
    fireEvent.click(pin)
    fireEvent.click(pin)

    expect(lastPosted("logos:story-popover-hide")).toBeDefined()
  })

  it("resets state when studio sends popover-closed message", async () => {
    vi.spyOn(window.parent, "postMessage").mockImplementation(() => {})

    render(
      <StorybookCommentLayer storyId="jobcard--default" component="JobCard">
        <section>
          <button type="button">Apply</button>
        </section>
      </StorybookCommentLayer>
    )

    fireEvent.click(screen.getByRole("button", { name: "Apply" }), { altKey: true })

    expect(lastPosted("logos:story-popover-show")).toMatchObject({ kind: "composer" })

    window.dispatchEvent(new MessageEvent("message", {
      data: { type: "logos:story-popover-closed" },
    }))

    await waitFor(() => {
      const shows = postedMessages("logos:story-popover-show")
      const lastShow = shows.at(-1)
      expect(lastShow).toMatchObject({ kind: "composer" })
    })
  })
})
