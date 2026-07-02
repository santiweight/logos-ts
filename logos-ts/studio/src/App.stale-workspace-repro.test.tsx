import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { App } from "./App"
import type { Goal, StudioIndex, Workspace, WorkspaceMeta } from "./types"

const originalFetch = globalThis.fetch
const originalResizeObserver = globalThis.ResizeObserver

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
  }
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, value: 260 })
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 600 })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  globalThis.fetch = originalFetch
  window.localStorage.clear()
})

afterAll(() => {
  globalThis.ResizeObserver = originalResizeObserver
})

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

function index(componentName: string, code: string): StudioIndex {
  return {
    root: "/tmp/project",
    files: [{
      file: `components/${componentName}.tsx`,
      code,
      items: [],
      component: {
        name: componentName,
        signature: `${componentName}()`,
        componentCode: code,
        propsFields: [],
        stories: [],
      },
    }],
  }
}

function goal(id: string, label: string): Goal {
  return {
    id,
    text: label,
    label,
    target: `component:${label}`,
    mode: "code",
    createdAt: 1000,
    status: "done",
    baseInstanceId: "base",
  }
}

function meta(workspace: Workspace): WorkspaceMeta {
  const {
    id,
    name,
    kind,
    parentId,
    createdAt,
    baseInstanceId,
    activeInstanceId,
    goals,
    initialization,
    publication,
  } = workspace
  return {
    id,
    name,
    kind,
    parentId,
    createdAt,
    baseInstanceId,
    activeInstanceId,
    goals,
    ...(initialization ? { initialization } : {}),
    ...(publication ? { publication } : {}),
  }
}

function workspace(id: string, name: string, createdAt: number, activeIndex: StudioIndex, goals: Goal[] = []): Workspace {
  const baseIndex = index("BaseComponent", "export function BaseComponent() { return null }")
  return {
    id,
    name,
    kind: "code",
    parentId: "ws-parent",
    createdAt,
    baseInstanceId: "base",
    activeInstanceId: `${id}-active`,
    goals,
    forkDir: `/tmp/${id}`,
    index: activeIndex,
    instances: {
      base: {
        id: "base",
        workspaceId: id,
        materializedRoot: `/tmp/${id}/base`,
        mutability: "immutable",
        createdAt: createdAt - 1,
        index: baseIndex,
      },
      [`${id}-active`]: {
        id: `${id}-active`,
        workspaceId: id,
        materializedRoot: `/tmp/${id}/active`,
        mutability: "writable",
        createdAt,
        index: activeIndex,
      },
    },
  }
}

describe("App workspace switching", () => {
  it("opens the owning workspace when a change is selected", async () => {
    const oldGoal = goal("goal-old", "Old goal")
    const oldWorkspace = workspace(
      "ws-old",
      "Old Workspace",
      2000,
      index("OldComponent", "export function OldComponent() { return <div>old</div> }"),
      [oldGoal],
    )
    const newWorkspace = workspace(
      "ws-new",
      "New Workspace",
      1000,
      index("NewComponent", "export function NewComponent() { return <div>new</div> }"),
    )
    const parentWorkspace = workspace("ws-parent", "Parent Workspace", 0, index("BaseComponent", "export function BaseComponent() { return null }"))

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString()
      if (url === "/api/index") return jsonResponse(parentWorkspace.index)
      if (url === "/api/test-results") return jsonResponse({ status: "idle", results: null, runningSince: null })
      if (url === "/api/storybooks") return jsonResponse({ urls: {}, states: {} })
      if (url === "/api/run-targets") return jsonResponse({ targets: [] })
      if (url === "/api/runs") return jsonResponse({ urls: {}, states: {} })
      if (url === "/api/demos") return jsonResponse({ active: "test", demos: [] })
      if (url === "/api/workspaces") return jsonResponse([meta(oldWorkspace), meta(newWorkspace)])
      if (url === "/api/workspaces/ws-old") return jsonResponse(oldWorkspace)
      if (url === "/api/workspaces/ws-new") return jsonResponse(newWorkspace)
      if (url === "/api/workspaces/ws-parent") return jsonResponse(parentWorkspace)
      if (url === "/api/sessions?goal=goal-old") return jsonResponse({ events: [] })
      throw new Error(`unhandled fetch: ${url}`)
    }) as typeof fetch

    render(<App />)

    expect(await screen.findByText("OldComponent")).toBeInTheDocument()

    const oldWorkspaceRow = screen.getAllByText("Old Workspace")
      .find((el) => el.classList.contains("rail-title"))
      ?.closest(".rail-row")
    expect(oldWorkspaceRow).not.toBeNull()
    fireEvent.click(oldWorkspaceRow!)
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/workspaces/ws-old", expect.objectContaining({ cache: "no-store" }))
    })
    expect(globalThis.fetch).not.toHaveBeenCalledWith("/api/workspaces/ws-old/reindex?goal=goal-old", { method: "POST" })

    fireEvent.click(screen.getByText("New Workspace"))
    expect(await screen.findByText("NewComponent")).toBeInTheDocument()

    await waitFor(() => {
      const activeWorkspace = screen.getAllByText("New Workspace")[0]?.closest(".rail-row")
      expect(activeWorkspace).toHaveClass("active")
      expect(within(document.querySelector(".sidebar") as HTMLElement).getByText("NewComponent")).toBeInTheDocument()
    })
  })
})
