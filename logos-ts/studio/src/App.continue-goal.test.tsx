import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { App } from "./App"
import type { Goal, StudioIndex, Workspace, WorkspaceMeta } from "./types"

const originalFetch = globalThis.fetch
const originalResizeObserver = globalThis.ResizeObserver
const originalEventSource = globalThis.EventSource

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
  }
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, value: 260 })
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 600 })
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  globalThis.fetch = originalFetch
  globalThis.EventSource = originalEventSource
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

function sseResponse(events: unknown[]): Response {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("")
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  })
}

function index(): StudioIndex {
  return {
    root: "/tmp/project",
    files: [{
      file: "components/Card.tsx",
      code: "export function Card() { return null }",
      items: [],
      component: {
        name: "Card",
        signature: "Card()",
        componentCode: "export function Card() { return null }",
        propsFields: [],
        stories: [],
      },
    }],
  }
}

function doneGoal(): Goal {
  return {
    id: "goal-1",
    text: "Make the card bold",
    label: "Card",
    target: "component:Card",
    mode: "code",
    createdAt: 1000,
    status: "done",
    sessionId: "session-abc",
    baseInstanceId: "base",
    workingInstanceId: "active",
  }
}

function workspace(): Workspace {
  const idx = index()
  return {
    id: "ws-1",
    name: "Workspace",
    kind: "code",
    parentId: null,
    createdAt: 1000,
    baseInstanceId: "base",
    activeInstanceId: "active",
    goals: [doneGoal()],
    forkDir: "/tmp/ws-1",
    index: idx,
    instances: {
      base: {
        id: "base",
        workspaceId: "ws-1",
        materializedRoot: "/tmp/ws-1/base",
        mutability: "immutable",
        createdAt: 999,
        index: idx,
      },
      active: {
        id: "active",
        workspaceId: "ws-1",
        materializedRoot: "/tmp/ws-1/active",
        mutability: "writable",
        createdAt: 1000,
        index: idx,
      },
    },
  }
}

function meta(ws: Workspace): WorkspaceMeta {
  return {
    id: ws.id,
    name: ws.name,
    kind: ws.kind,
    parentId: ws.parentId,
    createdAt: ws.createdAt,
    baseInstanceId: ws.baseInstanceId,
    activeInstanceId: ws.activeInstanceId,
    goals: ws.goals,
  }
}

const sessionHistory = [
  { type: "status", payload: JSON.stringify({ type: "status", goalId: "goal-1", message: "starting agent…" }) },
  { type: "event", payload: JSON.stringify({ type: "event", event: { type: "system", subtype: "init", model: "claude-sonnet-4-6", session_id: "session-abc" } }) },
  { type: "event", payload: JSON.stringify({ type: "event", event: { type: "assistant", message: { content: [{ type: "text", text: "I made the card bold." }] } } }) },
  { type: "event", payload: JSON.stringify({ type: "done", code: 0 }) },
]

describe("continueGoal preserves session history", () => {
  it("loads previous session events when sending a follow-up message", async () => {
    const ws = workspace()
    const continueResponses: Response[] = []

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString()
      if (url === "/api/index") return jsonResponse(index())
      if (url === "/api/test-results") return jsonResponse({ status: "idle", results: null, runningSince: null })
      if (url === "/api/storybooks") return jsonResponse({ urls: {}, states: {} })
      if (url === "/api/run-targets") return jsonResponse({ targets: [] })
      if (url === "/api/runs") return jsonResponse({ urls: {}, states: {} })
      if (url === "/api/demos") return jsonResponse({ active: "test", demos: [] })
      if (url === "/api/workspaces" && !url.includes("/ws-")) return jsonResponse([meta(ws)])
      if (url === "/api/workspaces/ws-1" && !init?.method) return jsonResponse(ws)
      if (url.startsWith("/api/workspaces/ws-1/reindex")) return jsonResponse(ws)
      if (url === "/api/sessions?goal=goal-1") return jsonResponse({ session: { id: "session-abc", goalId: "goal-1" }, events: sessionHistory })
      if (url === "/api/agent/continue" && init?.method === "POST") {
        return sseResponse([
          { type: "status", goalId: "goal-1", message: "continuing conversation…" },
          { type: "event", event: { type: "assistant", message: { content: [{ type: "text", text: "Done, count is bold now." }] } } },
          { type: "done", code: 0 },
        ])
      }
      throw new Error(`unhandled fetch: ${url} ${init?.method ?? "GET"}`)
    }) as typeof fetch

    render(<App />)

    const workspaces = await screen.findAllByText("Workspace")
    const threadRow = workspaces.find((el) => el.classList.contains("rail-title"))?.closest(".rail-row")
    expect(threadRow).not.toBeNull()
    fireEvent.click(threadRow!)

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Continue the thread...")).toBeInTheDocument()
    })

    const textarea = screen.getByPlaceholderText("Continue the thread...")
    fireEvent.change(textarea, { target: { value: "Also make the count bold" } })
    fireEvent.click(screen.getByText("Send"))

    await waitFor(() => {
      expect(screen.getByText("Done, count is bold now.")).toBeInTheDocument()
    })

    expect(screen.getByText("I made the card bold.")).toBeInTheDocument()
  })
})

describe("story comments", () => {
  it("posts the goal without waiting for the new workspace to finish opening", async () => {
    const ws = workspace()
    const createdWs: WorkspaceMeta = {
      ...meta(ws),
      id: "ws-2",
      name: "Comment target",
      parentId: ws.id,
      createdAt: 1001,
      baseInstanceId: "base-2",
      activeInstanceId: "active-2",
      goals: [],
      initialization: {
        status: "initializing",
        updatedAt: 1001,
        steps: [{ id: "index", label: "Index workspace", status: "running" }],
      },
    }
    const goalPosts: Array<{ url: string; body: unknown }> = []
    let created = false

    globalThis.EventSource = class {
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: (() => void) | null = null
      close = vi.fn()
      constructor(public url: string) {}
    } as unknown as typeof EventSource

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString()
      if (url === "/api/index") return jsonResponse(index())
      if (url === "/api/test-results") return jsonResponse({ status: "idle", results: null, runningSince: null })
      if (url === "/api/storybooks") return jsonResponse({ urls: {}, states: {} })
      if (url === "/api/run-targets") return jsonResponse({ targets: [] })
      if (url === "/api/runs") return jsonResponse({ urls: {}, states: {} })
      if (url === "/api/demos") return jsonResponse({ active: "test", demos: [] })
      if (url === "/api/sessions?goal=goal-created") return jsonResponse({ session: null, events: [] })
      if (url === "/api/workspaces/ws-2/goals" && init?.method === "POST") {
        goalPosts.push({ url, body: JSON.parse(String(init.body)) })
        return jsonResponse({
          id: "goal-created",
          text: "Make it clearer",
          label: "Comment target",
          target: "component:Card",
          mode: "code",
          createdAt: 1002,
          status: "pending",
          workspaceId: "ws-2",
        })
      }
      if (url === "/api/workspaces" && init?.method === "POST") {
        created = true
        return jsonResponse(createdWs)
      }
      if (url === "/api/workspaces") {
        if (created) return new Promise<Response>(() => {})
        return jsonResponse([meta(ws)])
      }
      if (url === "/api/workspaces/ws-1" && !init?.method) return jsonResponse(ws)
      if (url === "/api/workspaces/ws-2" && !init?.method) return new Promise<Response>(() => {})
      throw new Error(`unhandled fetch: ${url} ${init?.method ?? "GET"}`)
    }) as typeof fetch

    render(<App />)

    await screen.findAllByText("Workspace")
    await act(async () => {
      window.postMessage({
        type: "logos:story-comment",
        clientEventId: "comment-race",
        storyId: "card--default",
        component: "Card",
        selector: ":scope",
        label: "Comment target",
        text: "Make it clearer",
      }, "*")
    })

    await waitFor(() => {
      expect(goalPosts).toHaveLength(1)
    })
    expect(goalPosts[0]).toMatchObject({
      url: "/api/workspaces/ws-2/goals",
      body: {
        target: "component:Card",
        label: "Comment target",
        text: "Make it clearer",
        fork: true,
      },
    })
  })
})

describe("story generation", () => {
  it("creates a forked workspace before adding a Generate Stories goal", async () => {
    const ws = workspace()
    const createdWs: Workspace = {
      ...ws,
      id: "ws-2",
      name: "Generate Stories for Card",
      parentId: ws.id,
      createdAt: 1001,
      baseInstanceId: "base-2",
      activeInstanceId: "active-2",
      goals: [],
      forkDir: "/tmp/ws-2",
      instances: {
        ...ws.instances,
        "base-2": {
          ...ws.instances.base,
          id: "base-2",
          workspaceId: "ws-2",
          materializedRoot: "/tmp/ws-2/base",
          createdAt: 1001,
        },
        "active-2": {
          ...ws.instances.active,
          id: "active-2",
          workspaceId: "ws-2",
          materializedRoot: "/tmp/ws-2/active",
          createdAt: 1002,
        },
      },
    }
    const workspaceCreates: unknown[] = []
    const goalPosts: Array<{ url: string; body: unknown }> = []
    let created = false

    globalThis.EventSource = class {
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: (() => void) | null = null
      close = vi.fn()
      constructor(public url: string) {}
    } as unknown as typeof EventSource

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString()
      if (url === "/api/index") return jsonResponse(index())
      if (url === "/api/test-results") return jsonResponse({ status: "idle", results: null, runningSince: null })
      if (url === "/api/storybooks") return jsonResponse({ urls: {}, states: {} })
      if (url === "/api/run-targets") return jsonResponse({ targets: [] })
      if (url === "/api/runs") return jsonResponse({ urls: {}, states: {} })
      if (url === "/api/demos") return jsonResponse({ active: "test", demos: [] })
      if (url === "/api/sessions?goal=goal-generated") return jsonResponse({ session: null, events: [] })
      if (url === "/api/workspaces/ws-2/goals" && init?.method === "POST") {
        goalPosts.push({ url, body: JSON.parse(String(init.body)) })
        return jsonResponse({
          id: "goal-generated",
          text: "Generate Storybook stories for `Card`.",
          label: "Card",
          target: "component:Card",
          mode: "code",
          createdAt: 1002,
          status: "pending",
          workspaceId: "ws-2",
        })
      }
      if (url === "/api/workspaces" && init?.method === "POST") {
        const body = JSON.parse(String(init.body))
        workspaceCreates.push(body)
        created = true
        return jsonResponse(meta(createdWs))
      }
      if (url === "/api/workspaces") return jsonResponse(created ? [meta(ws), meta(createdWs)] : [meta(ws)])
      if (url === "/api/workspaces/ws-1" && !init?.method) return jsonResponse(ws)
      if (url === "/api/workspaces/ws-2" && !init?.method) return jsonResponse(createdWs)
      throw new Error(`unhandled fetch: ${url} ${init?.method ?? "GET"}`)
    }) as typeof fetch

    render(<App />)

    await screen.findAllByText("Workspace")
    const componentNode = await screen.findByText("Card")
    fireEvent.contextMenu(componentNode)
    fireEvent.click(await screen.findByText("Generate stories"))

    await waitFor(() => {
      expect(workspaceCreates).toEqual([{
        fromWorkspaceId: "ws-1",
        kind: "code",
        name: "Generate Stories for Card",
      }])
      expect(goalPosts).toHaveLength(1)
    })
    expect(goalPosts[0]).toMatchObject({
      url: "/api/workspaces/ws-2/goals",
      body: {
        target: "component:Card",
        label: "Card",
        text: "Generate Storybook stories for `Card`.",
        fork: true,
        component: "Card",
        goalName: "Generate Stories for Card",
      },
    })
  })
})
