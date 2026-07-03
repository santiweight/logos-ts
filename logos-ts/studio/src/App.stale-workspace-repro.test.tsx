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
    type: "local",
    parentId,
    createdAt,
    baseInstanceId,
    activeInstanceId,
    goals,
    ...(initialization ? { initialization } : {}),
    ...(publication ? { publication } : {}),
  }
}

function workspace(
  id: string,
  name: string,
  createdAt: number,
  activeIndex: StudioIndex,
  goals: Goal[] = [],
  overrides: Partial<Workspace> = {},
): Workspace {
  const baseIndex = index("BaseComponent", "export function BaseComponent() { return null }")
  return {
    id,
    name,
    kind: "code",
    type: "local",
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
    ...overrides,
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

    globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
      if (url === "/api/index") return Promise.resolve(jsonResponse(parentWorkspace.index))
      if (url === "/api/test-results") return Promise.resolve(jsonResponse({ status: "idle", results: null, runningSince: null }))
      if (url === "/api/storybooks") return Promise.resolve(jsonResponse({ urls: {}, states: {} }))
      if (url === "/api/run-targets") return Promise.resolve(jsonResponse({ targets: [] }))
      if (url === "/api/runs") return Promise.resolve(jsonResponse({ urls: {}, states: {} }))
      if (url === "/api/demos") return Promise.resolve(jsonResponse({ active: "test", demos: [] }))
      if (url === "/api/workspaces") return Promise.resolve(jsonResponse([{ ...meta(oldWorkspace), type: "local" }, { ...meta(newWorkspace), type: "local" }]))
      if (url === "/api/workspaces/ws-old") return Promise.resolve(jsonResponse(oldWorkspace))
      if (url === "/api/workspaces/ws-new") return Promise.resolve(jsonResponse(newWorkspace))
      if (url === "/api/workspaces/ws-parent") return Promise.resolve(jsonResponse(parentWorkspace))
      if (url === "/api/sessions?goal=goal-old") return Promise.resolve(jsonResponse({ events: [] }))
      throw new Error(`unhandled fetch: ${url}`)
    })

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

  it("keeps the current workspace visible when switching to an initializing workspace", async () => {
    const readyWorkspace = workspace(
      "ws-ready",
      "Ready Workspace",
      2000,
      index("ReadyComponent", "export function ReadyComponent() { return <div>ready</div> }"),
    )
    const initializingWorkspace = workspace(
      "ws-init",
      "Initializing Workspace",
      1000,
      index("InitializingComponent", "export function InitializingComponent() { return <div>init</div> }"),
      [],
      {
        initialization: {
          status: "initializing",
          updatedAt: 3000,
          steps: [
            { id: "materialize", label: "Materialize workspace", status: "done" },
            { id: "story_snapshots", label: "Capture story snapshots", status: "running" },
            { id: "commit_baseline", label: "Commit snapshot baseline", status: "pending" },
            { id: "index", label: "Index workspace", status: "pending" },
          ],
        },
      },
    )

    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
      if (url === "/api/index") return Promise.resolve(jsonResponse(readyWorkspace.index))
      if (url === "/api/test-results") return Promise.resolve(jsonResponse({ status: "idle", results: null, runningSince: null }))
      if (url === "/api/storybooks") return Promise.resolve(jsonResponse({ urls: {}, states: {} }))
      if (url === "/api/run-targets") return Promise.resolve(jsonResponse({ targets: [] }))
      if (url === "/api/runs") return Promise.resolve(jsonResponse({ urls: {}, states: {} }))
      if (url === "/api/demos") return Promise.resolve(jsonResponse({ active: "test", demos: [] }))
      if (url === "/api/workspaces") return Promise.resolve(jsonResponse([meta(readyWorkspace), meta(initializingWorkspace)]))
      if (url === "/api/workspaces/ws-ready") return Promise.resolve(jsonResponse(readyWorkspace))
      if (url === "/api/workspaces/ws-init") return Promise.resolve(jsonResponse(initializingWorkspace))
      throw new Error(`unhandled fetch: ${url}`)
    })

    render(<App />)

    expect(await screen.findByText("ReadyComponent")).toBeInTheDocument()
    expect(document.querySelector(".rail")).toBeInTheDocument()

    fireEvent.click(screen.getByText("Initializing Workspace"))

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/workspaces/ws-init", expect.objectContaining({ cache: "no-store" }))
    })
    expect(screen.queryByText("Initialize workspace")).not.toBeInTheDocument()
    expect(screen.getByText("ReadyComponent")).toBeInTheDocument()
    expect(screen.getByText(/initializing/)).toBeInTheDocument()
    expect(document.querySelector(".rail")).toBeInTheDocument()
    expect(document.querySelector(".sidebar")).toBeInTheDocument()
    expect(document.querySelector(".workspace-init-shell")).not.toBeInTheDocument()
  })
})
