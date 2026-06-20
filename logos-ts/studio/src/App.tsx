/* eslint-disable @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unnecessary-condition, no-restricted-syntax */
import { useState, useEffect, useCallback, useMemo, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react"
import { SidebarTree } from "./SidebarTree"
import { ContentPanel, RunView } from "./ContentPanel"
import { CommentPopup } from "./CommentPopup"
import { ChangesRail } from "./ChangesRail"
import { ICONS, svgIcon } from "./icons"
import { AgentPanel, type AgentMsg } from "./AgentPanel"
import { CommentSidebar } from "./CommentSidebar"
import { ReviewPanel } from "./ReviewPanel"
import { mainChromeState } from "./main-chrome"
import { GotoCtx } from "./highlight"
import { diffIndex } from "./diff"
import { selectReviewBaseIndex, selectWorkspaceReviewBaseIndex, snapshotChanges } from "./review"
import { indexToArchText } from "./arch-text"
import { buildStoryWritingPrompt } from "./story-goals"
import type {
  Goal,
  DiffStatus,
  RunState,
  RunTarget,
  SbState,
  Selection,
  StudioIndex,
  TestState,
  Workspace,
  WorkspaceKind,
  WorkspaceMeta,
} from "./types"
import seedData from "./studio-index.json"

const seed = seedData as unknown as StudioIndex
const SELECTION_STORAGE_KEY = "logos:selection:v1"

export function reviewChangeCount(base: StudioIndex, workspace: StudioIndex): number {
  const architectureChanged = indexToArchText(base) !== indexToArchText(workspace)
  return (architectureChanged ? 1 : 0) + snapshotChanges(base, workspace).length
}

interface DemoOption {
  id: string
  name: string
  root: string
}

function combineDiffStatus(
  current: DiffStatus | undefined,
  next: DiffStatus | undefined
): DiffStatus | undefined {
  if (!current) return next
  if (!next || current === next) return current
  return "changed"
}

function branchNameFromWorkspace(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return slug ? `logos/${slug}` : "logos/workspace"
}

function defaultSelection(): Selection {
  return {
    file: "",
    view: "run",
  }
}

function readStoredSelection(): Selection {
  if (typeof window === "undefined") return defaultSelection()
  try {
    const raw = window.localStorage.getItem(SELECTION_STORAGE_KEY)
    if (!raw) return defaultSelection()
    const parsed = JSON.parse(raw) as Partial<Selection>
    if (!parsed || typeof parsed.view !== "string") return defaultSelection()
    if (!["code", "arch", "story", "run"].includes(parsed.view)) return defaultSelection()
    if (parsed.view === "run") {
      return {
        file: "",
        view: "run",
        ...(typeof parsed.runTargetId === "string" ? { runTargetId: parsed.runTargetId } : {}),
      }
    }
    return {
      file: typeof parsed.file === "string" ? parsed.file : seed.files[0]?.file ?? "",
      view: parsed.view,
      ...(typeof parsed.symbol === "string" ? { symbol: parsed.symbol } : {}),
      ...(typeof parsed.component === "string" ? { component: parsed.component } : {}),
      ...(typeof parsed.storyId === "string" ? { storyId: parsed.storyId } : {}),
      ...(typeof parsed.exportName === "string" ? { exportName: parsed.exportName } : {}),
    }
  } catch {
    return defaultSelection()
  }
}

export function buildStorybookRenderKey(
  activeWs: Pick<WorkspaceMeta, "activeInstanceId" | "goals"> | undefined,
  activeStorybookState: Pick<SbState, "startedAt"> | null,
): string {
  let terminalCount = 0
  let terminalHash = 0
  for (const goal of activeWs?.goals ?? []) {
    if (goal.status !== "done" && goal.status !== "error") continue
    terminalCount += 1
    const lastReply = goal.replies?.[goal.replies.length - 1]
    const signature = `${goal.id}:${goal.status}:${goal.replies?.length ?? 0}:${lastReply?.createdAt ?? 0}`
    for (let i = 0; i < signature.length; i++) {
      terminalHash = ((terminalHash * 31) + signature.charCodeAt(i)) >>> 0
    }
  }
  return `${activeWs?.activeInstanceId ?? ""}:${activeStorybookState?.startedAt ?? 0}:${terminalCount}:${terminalHash.toString(36)}`
}

export function resolveAgentPanelGoalId(
  selected: { type: "workspace" | "goal"; id: string } | null,
  latestAgentGoalId: string | null,
): string | null {
  return selected?.type === "goal" ? selected.id : latestAgentGoalId
}

function storyCommentClientEventId(data: unknown): string | null {
  if (typeof data !== "object" || data == null) return null
  const record = data as Record<string, unknown>
  if (record["type"] !== "logos:story-comment") return null
  const clientEventId = record["clientEventId"]
  return typeof clientEventId === "string" && clientEventId.length > 0 ? clientEventId : null
}

export function createStoryCommentEventDedupe(limit = 200): (data: unknown) => boolean {
  const seen = new Set<string>()
  const order: string[] = []
  return (data: unknown): boolean => {
    const clientEventId = storyCommentClientEventId(data)
    if (clientEventId == null) return true
    if (seen.has(clientEventId)) return false
    seen.add(clientEventId)
    order.push(clientEventId)
    while (order.length > limit) {
      const oldest = order.shift()
      if (oldest != null) seen.delete(oldest)
    }
    return true
  }
}

export function App() {
  const [index, setIndex] = useState<StudioIndex>(seed)
  const [busy, setBusy] = useState<string | null>(null)
  const [goalError, setGoalError] = useState<string | null>(null)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [selection, setSelection] = useState<Selection>(() => readStoredSelection())
  const [popup, setPopup] = useState<{ target: string; label: string; x: number; y: number } | null>(
    null
  )
  const [demoMenuOpen, setDemoMenuOpen] = useState(false)
  const [demos, setDemos] = useState<DemoOption[]>([])
  const [activeDemoId, setActiveDemoId] = useState<string>("")
  const [demoSwitching, setDemoSwitching] = useState<string | null>(null)

  // ---- workspaces (forks) ----
  const [railOpen, setRailOpen] = useState(true)
  const [railWidth, setRailWidth] = useState(280)
  const [commentWidth, setCommentWidth] = useState(320)
  const [sidebarFilters, setSidebarFilters] = useState({
    functions: false,
    classes: true,
    components: true,
    types: false,
  })
  const [workspaces, setWorkspaces] = useState<WorkspaceMeta[]>([])
  const [workspacesLoading, setWorkspacesLoading] = useState(true)
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null)
  const [workspaceIndex, setWorkspaceIndex] = useState<StudioIndex | null>(null)
  const [workspaceBaselineIndex, setWorkspaceBaselineIndex] = useState<StudioIndex | null>(null)
  const [selected, setSelected] = useState<{ type: "workspace" | "goal"; id: string } | null>(null)

  const view: StudioIndex = workspaceIndex ?? { root: "", files: [] }
  const reviewBaseIndex = selectReviewBaseIndex(index, workspaceBaselineIndex)

  const [navHistory, setNavHistory] = useState<Selection[]>([])
  const onGoto = useCallback((sym: { file: string; line: number }, name: string) => {
    const file = view.files.find((f) => f.file === sym.file)
    if (file) {
      const isType = file.items.some((it) => it.kind === "type" && it.name === name)
      setSelection((prev) => {
        setNavHistory((h) => [...h, prev])
        return { file: sym.file, view: "code", ...(isType ? { symbol: name } : {}) }
      })
    } else {
      fetch("/api/open", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ file: sym.file, line: sym.line }),
      })
    }
  }, [view.files])
  const goBack = useCallback(() => {
    setNavHistory((h) => {
      if (h.length === 0) return h
      setSelection(h[h.length - 1]!)
      return h.slice(0, -1)
    })
  }, [])
  const gotoCtx = useMemo(() => ({ symbols: view.symbols ?? {}, onGoto }), [view.symbols, onGoto])

  const [storybookUrls, setStorybookUrls] = useState<Record<string, string>>({})
  const [storybookStates, setStorybookStates] = useState<Record<string, SbState>>({})
  const [storyCommentEditing, setStoryCommentEditing] = useState<Record<string, boolean>>({})
  const [storyCommentDrafts, setStoryCommentDrafts] = useState<Record<string, unknown>>({})
  const acceptStoryCommentEvent = useRef(createStoryCommentEventDedupe()).current
  const [runTargets, setRunTargets] = useState<RunTarget[]>([])
  const [runUrls, setRunUrls] = useState<Record<string, string>>({})
  const [runStates, setRunStates] = useState<Record<string, RunState>>({})
  const refreshStorybooks = useCallback(async () => {
    try {
      const res = await fetch("/api/storybooks", { cache: "no-store" })
      if (res.ok) {
        const data = await res.json() as { urls: Record<string, string>; states: Record<string, SbState> }
        setStorybookUrls(data.urls)
        setStorybookStates(data.states)
      }
    } catch {}
  }, [])
  const activeStorybookUrl = activeWorkspaceId
    ? storybookUrls[activeWorkspaceId] ?? ""
    : ""
  const activeStorybookState = activeWorkspaceId
    ? storybookStates[activeWorkspaceId] ?? null
    : null
  const activeStoryRenderer = activeStorybookUrl ? "storybook" : "portable"
  const retryStorybook = useCallback(async () => {
    if (!activeWorkspaceId) return
    try {
      await fetch(`/api/workspaces/${activeWorkspaceId}/storybook`, { method: "POST" })
    } catch {}
    refreshStorybooks()
  }, [activeWorkspaceId, refreshStorybooks])
  const refreshRunTargets = useCallback(async () => {
    try {
      const res = await fetch("/api/run-targets", { cache: "no-store" })
      if (res.ok) {
        const data = await res.json() as { targets: RunTarget[] }
        setRunTargets(data.targets)
      }
    } catch {}
  }, [])
  const refreshRuns = useCallback(async () => {
    try {
      const res = await fetch("/api/runs", { cache: "no-store" })
      if (res.ok) {
        const data = await res.json() as { urls: Record<string, string>; states: Record<string, RunState> }
        setRunUrls(data.urls)
        setRunStates(data.states)
      }
    } catch {}
  }, [])
  const runKey = useCallback((targetId: string) => (
    activeWorkspaceId ? `${activeWorkspaceId}:${targetId}` : ""
  ), [activeWorkspaceId])
  const runTarget = selection.view === "run" && selection.runTargetId
    ? runTargets.find((target) => target.id === selection.runTargetId) ?? null
    : null
  const activeRunUrl = runTarget ? runUrls[runKey(runTarget.id)] ?? "" : ""
  const activeRunState = runTarget ? runStates[runKey(runTarget.id)] ?? null : null
  const activeRunStatesByTarget = useMemo(() => {
    const out: Record<string, RunState | undefined> = {}
    if (!activeWorkspaceId) return out
    for (const target of runTargets) out[target.id] = runStates[`${activeWorkspaceId}:${target.id}`]
    return out
  }, [activeWorkspaceId, runTargets, runStates])
  useEffect(() => {
    if (selection.view === "run" && !selection.runTargetId && runTargets.length > 0) {
      setSelection((prev) => ({ ...prev, runTargetId: runTargets[0]!.id }))
    }
  }, [selection.view, selection.runTargetId, runTargets])

  const startRun = useCallback(async (targetId: string, restart = false) => {
    if (!activeWorkspaceId) return
    try {
      await fetch(`/api/workspaces/${activeWorkspaceId}/runs/${encodeURIComponent(targetId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ restart }),
      })
    } catch {}
    refreshRuns()
  }, [activeWorkspaceId, refreshRuns])

  const diff = useMemo(() => {
    if (!activeWorkspaceId || !workspaceIndex) return {}
    return diffIndex(reviewBaseIndex, workspaceIndex)
  }, [activeWorkspaceId, workspaceIndex, reviewBaseIndex])

  const activeWs = workspaces.find((w) => w.id === activeWorkspaceId)
  const activeGoals = activeWs?.goals ?? []
  const activeStorybookRenderKey = buildStorybookRenderKey(activeWs, activeStorybookState)

  const goalsByTarget = useMemo(() => {
    const m: Record<string, Goal[]> = {}
    for (const g of activeGoals) (m[g.target] ??= []).push(g)
    return m
  }, [activeGoals])

  const refreshWorkspaces = useCallback(async () => {
    try {
      setWorkspacesLoading(true)
      const res = await fetch("/api/workspaces")
      if (res.ok) setWorkspaces((await res.json()) as WorkspaceMeta[])
    } catch {} finally {
      setWorkspacesLoading(false)
    }
  }, [])
  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/index")
      if (res.ok) setIndex((await res.json()) as StudioIndex)
    } catch {}
  }, [])
  const [testState, setTestState] = useState<TestState | null>(null)
  const refreshTests = useCallback(async () => {
    try {
      const res = await fetch("/api/test-results")
      if (res.ok) setTestState((await res.json()) as TestState)
    } catch {}
  }, [])
  const refreshDemos = useCallback(async () => {
    try {
      const res = await fetch("/api/demos")
      if (!res.ok) return
      const data = await res.json() as { active: string; demos: DemoOption[] }
      setActiveDemoId(data.active)
      setDemos(data.demos)
    } catch {}
  }, [])

  const openWorkspace = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/workspaces/${id}`)
      if (res.ok) {
        const ws = (await res.json()) as Workspace
        setWorkspaceIndex(ws.index)
        setWorkspaceBaselineIndex(selectWorkspaceReviewBaseIndex(index, ws))
        setActiveWorkspaceId(id)
      }
    } catch {}
  }, [index])

  const reindexWorkspace = useCallback(async (id?: string | null) => {
    const wsId = id ?? activeWorkspaceId
    if (!wsId) return
    try {
      const res = await fetch(`/api/workspaces/${wsId}/reindex`, { method: "POST" })
      if (res.ok) {
        const ws = (await res.json()) as Workspace
        setWorkspaceIndex(ws.index)
        await refreshWorkspaces()
      }
    } catch {}
  }, [activeWorkspaceId, refreshWorkspaces])

  const createWorkspace = useCallback(
    async (fromWorkspaceId?: string | null, kind: WorkspaceKind = "code"): Promise<string | null> => {
      try {
        const res = await fetch("/api/workspaces", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ fromWorkspaceId: fromWorkspaceId ?? undefined, kind }),
        })
        if (!res.ok) return null
        const meta = (await res.json()) as WorkspaceMeta
        await refreshWorkspaces()
        await openWorkspace(meta.id)
        return meta.id
      } catch {
        return null
      }
    },
    [refreshWorkspaces, openWorkspace]
  )

  const deleteWorkspace = useCallback(
    async (id: string) => {
      await fetch(`/api/workspaces/${id}`, { method: "DELETE" })
      setSelected((s) => (s?.type === "workspace" && s.id === id ? null : s))
      await refreshWorkspaces()
      if (activeWorkspaceId === id) {
        const res = await fetch("/api/workspaces").catch(() => null)
        const wsList = res?.ok ? ((await res.json()) as WorkspaceMeta[]) : []
        if (wsList.length > 0) {
          const sorted = wsList.sort((a, b) => b.createdAt - a.createdAt)[0]
          if (sorted != null) await openWorkspace(sorted.id)
        } else {
          await createWorkspace()
        }
      }
    },
    [activeWorkspaceId, refreshWorkspaces, openWorkspace, createWorkspace]
  )

  const createWorkspacePullRequest = useCallback(async (id: string) => {
    const workspace = workspaces.find((w) => w.id === id)
    const workspaceName = workspace?.name?.trim() || "Logos workspace"
    const branchName = workspace?.publication?.branchName ?? branchNameFromWorkspace(workspaceName)
    setPublishError(null)
    setBusy(`${workspace?.publication ? "updating" : "creating"} merge request…`)
    try {
      const res = await fetch(`/api/workspaces/${id}/push-branch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ branchName, title: workspaceName }),
      })
      const data = await res.json().catch(() => ({})) as {
        error?: string
      }
      if (!res.ok) {
        setPublishError(data.error ?? "Failed to create merge request")
        return
      }
      await refreshWorkspaces()
    } finally {
      setBusy(null)
    }
  }, [workspaces, refreshWorkspaces])

  const deleteGoal = useCallback(
    async (wsId: string, goalId: string) => {
      await fetch(`/api/workspaces/${wsId}/goals/${goalId}`, { method: "DELETE" })
      setSelected((s) => (s?.type === "goal" && s.id === goalId ? null : s))
      await refreshWorkspaces()
    },
    [refreshWorkspaces]
  )

  const updateGoalAutoMerge = useCallback(
    async (goalId: string, autoMerge: boolean) => {
      if (!activeWorkspaceId) return
      await fetch(`/api/workspaces/${activeWorkspaceId}/goals/${encodeURIComponent(goalId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ autoMerge }),
      })
      await refreshWorkspaces()
    },
    [activeWorkspaceId, refreshWorkspaces]
  )

  // Boot
  const bootedRef = useRef(false)
  useEffect(() => {
    if (!bootedRef.current) {
      bootedRef.current = true
      ;(async () => {
        await Promise.all([refresh(), refreshTests(), refreshStorybooks(), refreshRunTargets(), refreshRuns(), refreshDemos()])
        const wsRes = await fetch("/api/workspaces", { cache: "no-store" }).catch(() => null)
        const wsList = wsRes?.ok ? ((await wsRes.json()) as WorkspaceMeta[]) : []
        setWorkspaces(wsList)
        setWorkspacesLoading(false)
        if (wsList.length > 0) {
          const latest = wsList.sort((a, b) => b.createdAt - a.createdAt)[0]
          if (latest != null) await openWorkspace(latest.id)
          for (const ws of wsList) {
            for (const goal of ws.goals ?? []) {
              if (goal.status === "running") {
                const history = await loadGoalSessionEvents(goal.id)
                if (history.length > 0) setGoalEvents((prev) => ({ ...prev, [goal.id]: history }))
                setAgentGoalId(goal.id)
                setAgentOpen(true)
                attachAgentStream(ws.id, goal.id)
              }
            }
          }
        } else {
          await createWorkspace()
        }
      })()
    }
    const iv = setInterval(() => { refreshTests(); refreshStorybooks(); refreshRuns() }, 2_000)
    return () => clearInterval(iv)
  }, [])

  const openDemo = useCallback(async (id: string) => {
    if (!id || id === activeDemoId || demoSwitching) {
      setDemoMenuOpen(false)
      return
    }
    const demo = demos.find((d) => d.id === id)
    setDemoMenuOpen(false)
    setDemoSwitching(id)
    setBusy(`opening ${demo?.name ?? id}…`)
    for (const es of esRefs.current.values()) es.close()
    esRefs.current.clear()
    try {
      const res = await fetch("/api/demos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      })
      if (!res.ok) {
        setBusy(null)
        setDemoSwitching(null)
        return
      }
      window.setTimeout(() => window.location.reload(), 1200)
    } catch {
      setBusy(null)
      setDemoSwitching(null)
    }
  }, [activeDemoId, demoSwitching, demos])

  useEffect(() => {
    try {
      window.localStorage.setItem(SELECTION_STORAGE_KEY, JSON.stringify(selection))
    } catch {}
  }, [selection])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Backspace") {
        const tag = (e.target as HTMLElement)?.tagName
        if (tag === "TEXTAREA" || tag === "INPUT") return
        const sel = selected ?? (activeWorkspaceId ? { type: "workspace" as const, id: activeWorkspaceId } : null)
        if (!sel) return
        e.preventDefault()
        if (sel.type === "workspace") deleteWorkspace(sel.id)
        else if (activeWorkspaceId) deleteGoal(activeWorkspaceId, sel.id)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [selected, activeWorkspaceId, deleteWorkspace, deleteGoal])

  const [reviewOpen, setReviewOpen] = useState(false)

  // ---- agent (per-goal) ----
  const [goalEvents, setGoalEvents] = useState<Record<string, AgentMsg[]>>({})
  const [runningGoals, setRunningGoals] = useState<Set<string>>(new Set())
  const [agentOpen, setAgentOpen] = useState(false)
  const [agentGoalId, setAgentGoalId] = useState<string | null>(null)
  const esRefs = useRef<Map<string, EventSource>>(new Map())

  const effectiveRunningGoals = useMemo(() => {
    const next = new Set(runningGoals)
    for (const ws of workspaces) {
      for (const goal of ws.goals ?? []) {
        if (goal.status === "running") next.add(goal.id)
      }
    }
    return next
  }, [runningGoals, workspaces])

  const agentPanelGoalId = resolveAgentPanelGoalId(selected, agentGoalId)
  const agentPanelGoal = agentPanelGoalId ? activeGoals.find((g) => g.id === agentPanelGoalId) ?? null : null
  const agentPanelEvents = agentPanelGoalId ? goalEvents[agentPanelGoalId] ?? [] : []
  const agentPanelRunning = agentPanelGoalId ? effectiveRunningGoals.has(agentPanelGoalId) : false
  const agentEvents = agentGoalId ? goalEvents[agentGoalId] ?? [] : []
  const agentRunning = agentGoalId ? effectiveRunningGoals.has(agentGoalId) : false

  const loadGoalSessionEvents = useCallback(async (goalId: string): Promise<AgentMsg[]> => {
    const res = await fetch(`/api/sessions?goal=${encodeURIComponent(goalId)}`).catch(() => null)
    if (!res?.ok) return []
    const data = await res.json().catch(() => null) as { events?: { payload?: string }[] } | null
    return (data?.events ?? []).flatMap((event): AgentMsg[] => {
      if (typeof event.payload !== "string") return []
      try {
        return [JSON.parse(event.payload) as AgentMsg]
      } catch {
        return []
      }
    })
  }, [])

  const attachAgentStream = useCallback(
    (wsId: string, goalId: string) => {
      if (esRefs.current.has(goalId)) return
      setRunningGoals((prev) => new Set(prev).add(goalId))
      const openStream = (attempt: number) => {
        let terminal = false
        const es = new EventSource(`/api/agent/run?workspace=${encodeURIComponent(wsId)}&goal=${encodeURIComponent(goalId)}`)
        esRefs.current.set(goalId, es)
        es.onmessage = (m) => {
          const msg = JSON.parse(m.data) as AgentMsg
          setGoalEvents((prev) => ({ ...prev, [goalId]: [...(prev[goalId] ?? []), msg] }))
          if (msg.type === "done" || msg.type === "error") {
            terminal = true
            es.close()
            esRefs.current.delete(goalId)
            setRunningGoals((prev) => { const next = new Set(prev); next.delete(goalId); return next })
            Promise.all([refreshWorkspaces(), refreshTests(), refreshStorybooks(), refreshRuns()]).then(() => openWorkspace(wsId))
          }
        }
        es.onerror = () => {
          if (terminal) return
          es.close()
          esRefs.current.delete(goalId)
          if (attempt < 3) {
            setGoalEvents((prev) => ({
              ...prev,
              [goalId]: [...(prev[goalId] ?? []), { type: "status", message: "agent stream disconnected; retrying…" }],
            }))
            const delay = Math.min(1000 * 2 ** attempt, 5000)
            window.setTimeout(async () => {
              const history = await loadGoalSessionEvents(goalId)
              if (history.length > 0) setGoalEvents((prev) => ({ ...prev, [goalId]: history }))
              openStream(attempt + 1)
            }, delay)
            return
          }
          setGoalEvents((prev) => ({
            ...prev,
            [goalId]: [...(prev[goalId] ?? []), { type: "error", message: "agent stream disconnected" }],
          }))
          setRunningGoals((prev) => { const next = new Set(prev); next.delete(goalId); return next })
          Promise.all([refreshWorkspaces(), refreshTests(), refreshStorybooks(), refreshRuns()]).then(() => openWorkspace(wsId))
        }
      }
      openStream(0)
    },
    [refreshWorkspaces, refreshTests, refreshStorybooks, refreshRuns, openWorkspace, loadGoalSessionEvents]
  )

  const runAgent = useCallback(
    (wsId: string, goalId?: string) => {
      if (!goalId) return
      setGoalEvents((prev) => ({ ...prev, [goalId]: [] }))
      setAgentGoalId(goalId)
      setAgentOpen(true)
      attachAgentStream(wsId, goalId)
    },
    [attachAgentStream]
  )

  const mergeGoal = useCallback(
    async (goalId: string) => {
      if (!activeWorkspaceId) return
      const history = await loadGoalSessionEvents(goalId)
      setGoalEvents((prev) => ({
        ...prev,
        [goalId]: [...((prev[goalId]?.length ?? 0) > 0 ? prev[goalId]! : history), { type: "status", message: "manual merge started" }],
      }))
      setRunningGoals((prev) => new Set(prev).add(goalId))
      setAgentGoalId(goalId)
      setAgentOpen(true)
      const es = new EventSource(`/api/agent/merge?workspace=${encodeURIComponent(activeWorkspaceId)}&goal=${encodeURIComponent(goalId)}`)
      esRefs.current.set(goalId, es)
      let terminal = false
      es.onmessage = (m) => {
        const msg = JSON.parse(m.data) as AgentMsg
        setGoalEvents((prev) => ({ ...prev, [goalId]: [...(prev[goalId] ?? []), msg] }))
        if (msg.type === "done" || msg.type === "error") {
          terminal = true
          es.close()
          esRefs.current.delete(goalId)
          setRunningGoals((prev) => { const next = new Set(prev); next.delete(goalId); return next })
          Promise.all([refreshWorkspaces(), refreshTests(), refreshStorybooks(), refreshRuns()]).then(() => openWorkspace(activeWorkspaceId))
        }
      }
      es.onerror = () => {
        if (terminal) return
        es.close()
        esRefs.current.delete(goalId)
        setGoalEvents((prev) => ({
          ...prev,
          [goalId]: [...(prev[goalId] ?? []), { type: "error", message: "merge stream disconnected" }],
        }))
        setRunningGoals((prev) => { const next = new Set(prev); next.delete(goalId); return next })
        Promise.all([refreshWorkspaces(), refreshTests(), refreshStorybooks(), refreshRuns()]).then(() => openWorkspace(activeWorkspaceId))
      }
    },
    [activeWorkspaceId, loadGoalSessionEvents, refreshWorkspaces, refreshTests, refreshStorybooks, refreshRuns, openWorkspace]
  )
  const closeAgent = useCallback(() => setAgentOpen(false), [])

  const resetWorkspaces = useCallback(async () => {
    if (!window.confirm("Delete all workspaces, goals, sessions, and generated forks, then start fresh?")) return
    setBusy("resetting workspace state…")
    for (const es of esRefs.current.values()) es.close()
    esRefs.current.clear()
    setRunningGoals(new Set())
    setGoalEvents({})
    setAgentGoalId(null)
    setAgentOpen(false)
    setSelected(null)
    setReviewOpen(false)
    setWorkspaceIndex(null)
    setWorkspaceBaselineIndex(null)
    setActiveWorkspaceId(null)

    try {
      const resetRes = await fetch("/api/reset", { method: "POST" })
      if (!resetRes.ok) return
      const data = await resetRes.json() as { workspace: WorkspaceMeta }
      setWorkspaces([data.workspace])
      setSelected({ type: "workspace", id: data.workspace.id })

      const wsRes = await fetch(`/api/workspaces/${data.workspace.id}`)
      if (wsRes.ok) {
        const ws = await wsRes.json() as Workspace
        setWorkspaceIndex(ws.index)
        setWorkspaceBaselineIndex(selectWorkspaceReviewBaseIndex(index, ws))
        setActiveWorkspaceId(ws.id)
        setSelection({ file: "", view: "run" })
      }
      await Promise.all([refreshTests(), refreshStorybooks(), refreshRuns()])
    } finally {
      setBusy(null)
    }
  }, [refreshTests, refreshStorybooks, refreshRuns])

  // Poll workspace index while agent is running
  useEffect(() => {
    if (!agentRunning || !activeWorkspaceId) return
    const iv = setInterval(() => openWorkspace(activeWorkspaceId), 3_000)
    return () => clearInterval(iv)
  }, [agentRunning, activeWorkspaceId, openWorkspace])

  // ---- actions ----
  const onFork = useCallback(async () => {
    setBusy("forking workspace…")
    try { await createWorkspace(activeWorkspaceId, activeWs?.kind ?? "code") } finally { setBusy(null) }
  }, [createWorkspace, activeWorkspaceId, activeWs?.kind])

  const onSelect = useCallback((sel: Selection) => setSelection(sel), [])

  const openComment = useCallback(
    (target: string, label: string, x: number, y: number) => {
      setGoalError(null)
      setPopup({ target, label, x, y })
    },
    []
  )

  const addGoal = useCallback(
    async (
      target: string, label: string, text: string, mode: "code" | "arch", fork: boolean,
      extra?: { storyId?: string; selector?: string; component?: string; htmlContext?: string; autoMerge?: boolean },
    ) => {
      // 1. Code forks are created client-side. Arch isolation is owned by the backend.
      let wsId = fork && mode === "code" ? await createWorkspace(activeWorkspaceId, "code") : activeWorkspaceId
      if (!wsId) wsId = await createWorkspace(null, "code")
      if (!wsId) return

      // 2. Add goal to workspace queue
      const goalRes = await fetch(`/api/workspaces/${wsId}/goals`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target, label, text, mode, fork, ...extra, autoMerge: extra?.autoMerge !== false }),
      })
      const result = await goalRes.json()
      if (!goalRes.ok) {
        setGoalError(typeof result.error === "string" ? result.error : "failed to add goal")
        return
      }
      setGoalError(null)
      const goal = result as Goal & { workspaceId?: string }
      const goalWsId = goal.workspaceId ?? wsId
      await refreshWorkspaces()
      setSelected({ type: "goal", id: goal.id })
      if (goalWsId !== activeWorkspaceId) await openWorkspace(goalWsId)

      // 3. Trigger agent to process the queue
      runAgent(goalWsId, goal.id)
    },
    [activeWorkspaceId, createWorkspace, refreshWorkspaces, openWorkspace, runAgent]
  )

  const continueGoal = useCallback(
    (goalId: string, text: string) => {
      if (!activeWorkspaceId) return
      setSelected({ type: "goal", id: goalId })
      setGoalEvents((prev) => ({ ...prev, [goalId]: [] }))
      setRunningGoals((prev) => new Set(prev).add(goalId))
      setAgentGoalId(goalId)
      setAgentOpen(true)
      let closed = false
      fetch("/api/agent/continue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspace: activeWorkspaceId, goal: goalId, text }),
      }).then((res) => {
        if (!res.ok || !res.body) {
          setRunningGoals((prev) => { const next = new Set(prev); next.delete(goalId); return next })
          return
        }
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ""
        const pump = (): Promise<void> =>
          reader.read().then(({ done, value }) => {
            if (done || closed) {
              setRunningGoals((prev) => { const next = new Set(prev); next.delete(goalId); return next })
              Promise.all([refreshWorkspaces(), refreshTests(), refreshStorybooks()]).then(() => {
                if (activeWorkspaceId) openWorkspace(activeWorkspaceId)
              })
              return
            }
            buf += decoder.decode(value, { stream: true })
            let idx
            while ((idx = buf.indexOf("\n\n")) >= 0) {
              const chunk = buf.slice(0, idx)
              buf = buf.slice(idx + 2)
              if (!chunk.startsWith("data: ")) continue
              try {
                const msg = JSON.parse(chunk.slice(6))
                setGoalEvents((prev) => ({ ...prev, [goalId]: [...(prev[goalId] ?? []), msg] }))
                if (msg.type === "done" || msg.type === "error") {
                  closed = true
                  setRunningGoals((prev) => { const next = new Set(prev); next.delete(goalId); return next })
                  Promise.all([refreshWorkspaces(), refreshTests(), refreshStorybooks()]).then(() => {
                    if (activeWorkspaceId) openWorkspace(activeWorkspaceId)
                  })
                  return
                }
              } catch {}
            }
            return pump()
          })
        pump()
      })
    },
    [activeWorkspaceId, refreshWorkspaces, refreshTests, refreshStorybooks, openWorkspace],
  )

  const addStoryWritingGoal = useCallback(
    (target: string, label: string) => {
      addGoal(target, label, buildStoryWritingPrompt(label), "code", false, { component: label })
    },
    [addGoal]
  )

  const storyGoalsMessage = useMemo(() => {
    const storyGoals = activeGoals
      .filter((g) => g.storyId)
      .map((g) => ({
        id: g.id,
        storyId: g.storyId,
        selector: g.selector ?? "",
        label: g.label,
        text: g.text,
        author: "you",
        createdAt: g.createdAt,
        component: g.component,
        mode: g.mode,
        status: g.status,
        replies: g.replies,
      }))
    return { type: "logos:story-goals", goals: storyGoals, drafts: Object.values(storyCommentDrafts), workspaceKind: activeWs?.kind ?? "code" }
  }, [activeGoals, activeWs?.kind, storyCommentDrafts])

  const postStoryGoals = useCallback((target?: Window | null) => {
    if (target) {
      try { target.postMessage(storyGoalsMessage, "*") } catch {}
      return
    }
    document.querySelectorAll<HTMLIFrameElement>("iframe.story-frame").forEach((f) => {
      try { f.contentWindow?.postMessage(storyGoalsMessage, "*") } catch {}
    })
  }, [storyGoalsMessage])

  // Listen for story comments from Storybook iframe
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === "logos:story-ready") {
        postStoryGoals(e.source as Window | null)
        return
      }
      if (e.data?.type === "logos:story-comment-editing") {
        const storyId = typeof e.data.storyId === "string" ? e.data.storyId : ""
        if (!storyId) return
        setStoryCommentEditing((current) => {
          const active = e.data.active === true
          if (active) return { ...current, [storyId]: true }
          const next = { ...current }
          delete next[storyId]
          return next
        })
        return
      }
      if (e.data?.type === "logos:story-comment-draft") {
        const storyId = typeof e.data.storyId === "string" ? e.data.storyId : ""
        if (!storyId) return
        const text = typeof e.data.text === "string" ? e.data.text : ""
        const active = e.data.active !== false && text.trim().length > 0
        setStoryCommentDrafts((current) => {
          if (!active) {
            const next = { ...current }
            delete next[storyId]
            return next
          }
          return { ...current, [storyId]: { ...e.data, active: true } }
        })
        setStoryCommentEditing((current) => {
          if (active) return { ...current, [storyId]: true }
          const next = { ...current }
          delete next[storyId]
          return next
        })
        return
      }
      if (e.data?.type !== "logos:story-comment") return
      if (!acceptStoryCommentEvent(e.data)) return
      const { storyId, component, selector, label, text, mode, fork, autoMerge, htmlContext } = e.data
      if (typeof storyId === "string" && storyId) {
        setStoryCommentDrafts((current) => {
          const next = { ...current }
          delete next[storyId]
          return next
        })
        setStoryCommentEditing((current) => {
          const next = { ...current }
          delete next[storyId]
          return next
        })
      }
      const target = component ? `component:${component}` : `story:${storyId}`
      addGoal(target, label ?? storyId, text, mode ?? "code", fork ?? false, { storyId, selector, component, htmlContext, autoMerge: autoMerge !== false })
    }
    window.addEventListener("message", onMsg)
    return () => window.removeEventListener("message", onMsg)
  }, [acceptStoryCommentEvent, addGoal, postStoryGoals])

  // Push goals to Storybook iframes so they can render pins
  useEffect(() => {
    postStoryGoals()
  }, [postStoryGoals])

  // Re-broadcast goals when story iframes load so pins appear immediately
  useEffect(() => {
    const onLoad = (e: Event) => {
      const iframe = e.target as HTMLIFrameElement
      if (iframe.classList?.contains("story-frame")) postStoryGoals(iframe.contentWindow)
    }
    document.addEventListener("load", onLoad, true)
    return () => document.removeEventListener("load", onLoad, true)
  }, [postStoryGoals])

  const currentFile = view.files.find((f) => f.file === selection.file) ?? view.files[0]

  const navigateToGoal = useCallback((goal: Goal) => {
    const target = goal.target
    const comp = target.startsWith("component:") ? target.slice("component:".length) : null
    const file = target.startsWith("file:") ? target.slice("file:".length) : null
    const symbolPrefix = target.startsWith("fn:")
      ? "fn:"
      : target.startsWith("type:")
        ? "type:"
        : target.startsWith("cls:")
          ? "cls:"
          : null
    const symbol = symbolPrefix != null ? target.slice(symbolPrefix.length) : null
    if (comp != null && comp.length > 0) {
      const f = view.files.find((f) => f.component?.name === comp || f.components?.some((c) => c.name === comp))
      if (f) {
        if (goal.storyId) {
          setSelection({ file: f.file, component: comp, view: "story", storyId: goal.storyId })
        } else {
          setSelection({ file: f.file, component: comp, view: "code" })
        }
      }
    } else if (symbol != null && symbol.length > 0) {
      const f = view.files.find((f) => f.items.some((item) => item.name === symbol))
      if (f) setSelection({ file: f.file, symbol, view: "code" })
    } else if (file != null && file.length > 0) {
      setSelection({ file, view: "code" })
    }
  }, [view.files])

  const selectedGoalId = selected?.type === "goal" ? selected.id : null
  const selectedGoal = selectedGoalId != null
    ? activeGoals.find((goal) => goal.id === selectedGoalId) ?? null
    : null
  const goalEventsRef = useRef(goalEvents)
  goalEventsRef.current = goalEvents
  const selectGoal = useCallback(async (id: string) => {
    setSelected({ type: "goal", id })
    const goal = activeGoals.find((candidate) => candidate.id === id)
    if (goal) navigateToGoal(goal)
    const existing = goalEventsRef.current[id]
    if (!existing || existing.length === 0) {
      const history = await loadGoalSessionEvents(id)
      if (history.length > 0) setGoalEvents((prev) => ({ ...prev, [id]: history }))
    }
  }, [activeGoals, navigateToGoal, loadGoalSessionEvents])

  const nComps = view.files.reduce((n, f) => n + (f.components?.length ?? (f.component ? 1 : 0)), 0)
  const totalGoals = workspaces.reduce((n, w) => n + (w.goals?.length ?? 0), 0)
  const reviewCount = workspaceIndex ? reviewChangeCount(reviewBaseIndex, workspaceIndex) : 0
  const mainChrome = mainChromeState({ selection, currentFile, runTarget, reviewOpen, reviewCount })
  const activeDemo = demos.find((d) => d.id === activeDemoId)
  const demoLabel = demoSwitching
    ? `Opening ${demos.find((d) => d.id === demoSwitching)?.name ?? demoSwitching}`
    : activeDemo?.name ?? "Custom"
  const studioStyle = { "--rail-width": `${railWidth}px`, "--comment-width": `${commentWidth}px` } as CSSProperties
  const startRailResize = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = railWidth
    document.body.classList.add("resizing-rail")
    const onMove = (move: PointerEvent) => {
      const next = startWidth + move.clientX - startX
      setRailWidth(Math.min(420, Math.max(260, next)))
    }
    const onUp = () => {
      document.body.classList.remove("resizing-rail")
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }, [railWidth])
  const startCommentResize = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = commentWidth
    document.body.classList.add("resizing-comments")
    const onMove = (move: PointerEvent) => {
      const next = startWidth + move.clientX - startX
      setCommentWidth(Math.min(520, Math.max(240, next)))
    }
    const onUp = () => {
      document.body.classList.remove("resizing-comments")
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }, [commentWidth])

  if (!activeWorkspaceId || !workspaceIndex) {
    return (
      <div className="studio" style={studioStyle}>
        <header className="topbar">
          <div className="topbar-menu">
            <button className="topbar-trigger" onClick={() => setDemoMenuOpen((o) => !o)} aria-label="Open menu">
              ☰
            </button>
            <span className="topbar-title">{demoLabel}</span>
          </div>
        </header>
        <div className="empty">Opening workspace…</div>
      </div>
    )
  }

  return (
    <div className={`studio ${railOpen ? "rail-open" : "rail-closed"}`} style={studioStyle}>
      <header className="topbar">
        <div className="topbar-menu">
          <button
            className={`topbar-trigger ${demoMenuOpen ? "active" : ""}`}
            onClick={() => setDemoMenuOpen((o) => !o)}
            aria-label="Open menu"
          >
            ☰
          </button>
          <span className="topbar-title">{demoLabel}</span>
          {demoMenuOpen && (
            <div className="demo-menu">
              <div className="demo-menu-title">Open Demo</div>
              {demos.map((demo) => (
                <button
                  key={demo.id}
                  className={`demo-menu-item ${demo.id === activeDemoId ? "active" : ""}`}
                  onClick={() => openDemo(demo.id)}
                >
                  <span>{demo.name}</span>
                  {demo.id === activeDemoId && <span className="demo-current">current</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>
      <ChangesRail
        open={railOpen}
        onToggle={() => setRailOpen((o) => !o)}
        workspaces={workspaces}
        workspacesLoading={workspacesLoading}
        activeWorkspaceId={activeWorkspaceId}
        selected={selected}
        onNewWorkspace={() => createWorkspace()}
        onResetWorkspaces={resetWorkspaces}
        onOpenWorkspace={(id) => {
          setSelected({ type: "workspace", id })
          openWorkspace(id)
        }}
        onFork={onFork}
        onCreatePullRequest={createWorkspacePullRequest}
        onSelectGoal={selectGoal}
        onDeleteWorkspace={deleteWorkspace}
        onDeleteGoal={deleteGoal}
        runningGoals={effectiveRunningGoals}
        onResizeStart={startRailResize}
      />

      <CommentSidebar
        goal={selectedGoal}
        running={selectedGoal != null && effectiveRunningGoals.has(selectedGoal.id)}
        onNavigate={navigateToGoal}
        onReply={continueGoal}
        onToggleAutoMerge={updateGoalAutoMerge}
        onMerge={mergeGoal}
        onResizeStart={startCommentResize}
      />

      <aside className="sidebar">
        <div className="sidebar-toolbar">
          <button
            className={`sidebar-filter fn ${sidebarFilters.functions ? "active" : ""}`}
            type="button"
            aria-pressed={sidebarFilters.functions}
            title={sidebarFilters.functions ? "Hide functions" : "Show functions"}
            onClick={() => setSidebarFilters((filters) => ({ ...filters, functions: !filters.functions }))}
          >
            {ICONS.fn}
          </button>
          <button
            className={`sidebar-filter cls ${sidebarFilters.classes ? "active" : ""}`}
            type="button"
            aria-pressed={sidebarFilters.classes}
            title={sidebarFilters.classes ? "Hide classes" : "Show classes"}
            onClick={() => setSidebarFilters((filters) => ({ ...filters, classes: !filters.classes }))}
          >
            {ICONS.cls}
          </button>
          <button
            className={`sidebar-filter comp ${sidebarFilters.components ? "active" : ""}`}
            type="button"
            aria-pressed={sidebarFilters.components}
            title={sidebarFilters.components ? "Hide React components" : "Show React components"}
            onClick={() => setSidebarFilters((filters) => ({ ...filters, components: !filters.components }))}
          >
            {ICONS.comp}
          </button>
          <button
            className={`sidebar-filter type ${sidebarFilters.types ? "active" : ""}`}
            type="button"
            aria-pressed={sidebarFilters.types}
            title={sidebarFilters.types ? "Hide types" : "Show types"}
            onClick={() => setSidebarFilters((filters) => ({ ...filters, types: !filters.types }))}
          >
            T
          </button>
        </div>
        <SidebarTree
          files={view.files}
          selection={selection}
          onSelect={onSelect}
          comments={goalsByTarget}
          onComment={openComment}
          onWriteStories={addStoryWritingGoal}
          diff={diff}
          testState={testState}
          runTargets={runTargets}
          runStates={activeRunStatesByTarget}
          onRun={startRun}
          showFunctions={sidebarFilters.functions}
          showClasses={sidebarFilters.classes}
          showComponents={sidebarFilters.components}
          showTypes={sidebarFilters.types}
        />
      </aside>

      <GotoCtx.Provider value={gotoCtx}>
      <main className="main">
        <nav className={`main-nav ${mainChrome.showModeTabs ? "" : "single"}`}>
          <div className="main-title-row">
            {navHistory.length > 0 && (
              <button className="nav-back" onClick={goBack} title="Go back">←</button>
            )}
            <span className="main-title">{mainChrome.title}</span>
          </div>
          {mainChrome.showModeTabs && (
            <div className="main-tabs">
              <button className={!mainChrome.changesOpen ? "active" : ""} onClick={() => setReviewOpen(false)}>
                Live
              </button>
              <button className={mainChrome.changesOpen ? "active" : ""} onClick={() => setReviewOpen(true)}>
                {mainChrome.changesLabel}
              </button>
            </div>
          )}
        </nav>
        <div className="main-view">
          {mainChrome.changesOpen ? (
            <ReviewPanel
              base={reviewBaseIndex}
              workspace={workspaceIndex}
              showHeaderTitle={false}
            />
          ) : selection.view === "run" ? (
            <RunView
              target={runTarget}
              runUrl={activeRunUrl}
              runState={activeRunState}
              onRun={startRun}
            />
          ) : currentFile ? (
            <ContentPanel
              file={currentFile}
              selection={selection}
              workspaceId={activeWorkspaceId}
              storyRenderer={activeStoryRenderer}
              storybookUrl={activeStorybookUrl}
              storybookState={activeStorybookState}
              storybookRenderKey={activeStorybookRenderKey}
              storyCommentEditingByStoryId={storyCommentEditing}
              onRetryStorybook={retryStorybook}
              showHeader={false}
              comments={goalsByTarget}
              onComment={openComment}
              diff={diff}
            />
          ) : (
            <div className="empty">No files indexed.</div>
          )}
        </div>
        {agentOpen && (
          <AgentPanel events={agentPanelEvents} running={agentPanelRunning} goal={agentPanelGoal} onClose={closeAgent} />
        )}
      </main>
      </GotoCtx.Provider>

      <footer className="statusbar">
        <span>
          {svgIcon("M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9", 11)}{" "}
          {activeWs?.name ?? "workspace"}{" "}
          <a className="refresh-btn" onClick={() => reindexWorkspace()} title="Re-index workspace from disk">↻</a>
        </span>
        <span>
          <span className="agent-toggle" onClick={() => setAgentOpen((o) => !o)}>
            {agentRunning ? (
              <>
                <span className="ag-spin">⟳</span> agent running
              </>
            ) : (
              `▣ agent log${agentEvents.length ? ` (${agentEvents.length})` : ""}`
            )}
          </span>
          {"   "}
          {testState && (
            <span className={`test-status ${testState.status}`}>
              {testState.status === "running" ? (
                <><span className="ag-spin">⟳</span> tests running</>
              ) : testState.results ? (
                `${testState.results.passed}✓ ${testState.results.failed}✗`
              ) : null}
            </span>
          )}
          {"   "}
          {goalError ? <span className="status-error">goal error: {goalError}</span> :
            publishError ? <span className="status-error">{publishError}</span> :
            busy ? busy :
            `${view.files.length} files · ${nComps} components · ${totalGoals} goals · ${workspaces.length} workspaces`}
        </span>
      </footer>

      {popup && (
        <CommentPopup
          x={popup.x}
          y={popup.y}
          label={popup.label}
          goals={goalsByTarget[popup.target] ?? []}
          workspaceKind={activeWs?.kind}
          onAdd={(text, mode, fork, autoMerge) => { addGoal(popup.target, popup.label, text, mode, fork, { autoMerge }); setPopup(null) }}
          onReply={(goalId, text) => { continueGoal(goalId, text) }}
          onClose={() => setPopup(null)}
        />
      )}
    </div>
  )
}
