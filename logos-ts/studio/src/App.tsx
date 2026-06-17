/* eslint-disable @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unnecessary-condition, no-restricted-syntax */
import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { SidebarTree } from "./SidebarTree"
import { ContentPanel } from "./ContentPanel"
import { CommentPopup } from "./CommentPopup"
import { ChangesRail } from "./ChangesRail"
import { ICONS, svgIcon } from "./icons"
import { AgentPanel, type AgentMsg } from "./AgentPanel"
import { ReviewPanel } from "./ReviewPanel"
import { diffIndex } from "./diff"
import {
  capturedTestChanges,
  selectReviewBaseIndex,
  selectWorkspaceOutcomeBaseIndex,
  selectWorkspaceReviewBaseIndex,
  selectWorkspaceReviewIndex,
} from "./review"
import { indexToArchText } from "./arch-text"
import type {
  Goal,
  ComponentEntry,
  DiffStatus,
  FileEntry,
  SbState,
  Selection,
  StudioIndex,
  TestState,
  View,
  Workspace,
  WorkspaceKind,
  WorkspaceMeta,
} from "./types"
import seedData from "./studio-index.json"

const seed = seedData as unknown as StudioIndex

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

function componentsOf(file: FileEntry | undefined): ComponentEntry[] {
  if (!file) return []
  return file.components?.length ? file.components : file.component ? [file.component] : []
}

export function App() {
  const [index, setIndex] = useState<StudioIndex>(seed)
  const [busy, setBusy] = useState<string | null>(null)
  const [goalError, setGoalError] = useState<string | null>(null)
  const [captureError, setCaptureError] = useState<string | null>(null)
  const [selection, setSelection] = useState<Selection>({
    file: seed.files[0]?.file ?? "",
    view: "code",
  })
  const [popup, setPopup] = useState<{ target: string; label: string; x: number; y: number } | null>(
    null
  )
  const [demoMenuOpen, setDemoMenuOpen] = useState(false)
  const [demos, setDemos] = useState<DemoOption[]>([])
  const [activeDemoId, setActiveDemoId] = useState<string>("")
  const [demoSwitching, setDemoSwitching] = useState<string | null>(null)

  // ---- workspaces (forks) ----
  const [railOpen, setRailOpen] = useState(true)
  const [sidebarFilters, setSidebarFilters] = useState({
    functions: true,
    classes: true,
    components: true,
  })
  const [workspaces, setWorkspaces] = useState<WorkspaceMeta[]>([])
  const [workspacesLoading, setWorkspacesLoading] = useState(true)
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null)
  const [workspaceIndex, setWorkspaceIndex] = useState<StudioIndex | null>(null)
  const [workspaceBaselineIndex, setWorkspaceBaselineIndex] = useState<StudioIndex | null>(null)
  const [workspaceReviewIndex, setWorkspaceReviewIndex] = useState<StudioIndex | null>(null)
  const [workspaceOutcomeBaselineIndex, setWorkspaceOutcomeBaselineIndex] = useState<StudioIndex | null>(null)
  const [selected, setSelected] = useState<{ type: "workspace" | "goal"; id: string } | null>(null)

  const view: StudioIndex = workspaceIndex ?? { root: "", files: [] }
  const reviewBaseIndex = selectReviewBaseIndex(index, workspaceBaselineIndex)
  const reviewWorkspaceIndex = workspaceReviewIndex ?? workspaceIndex
  const outcomeBaseIndex = selectReviewBaseIndex(index, workspaceOutcomeBaselineIndex)

  const [storybookUrls, setStorybookUrls] = useState<Record<string, string>>({})
  const [storybookStates, setStorybookStates] = useState<Record<string, SbState>>({})
  const refreshStorybooks = useCallback(async () => {
    try {
      const res = await fetch("/api/storybooks")
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

  const captureChanges = useMemo(
    () => workspaceIndex ? capturedTestChanges(outcomeBaseIndex, workspaceIndex) : [],
    [outcomeBaseIndex, workspaceIndex]
  )

  const diff = useMemo(() => {
    if (!activeWorkspaceId || !reviewWorkspaceIndex) return {}
    const next: Record<string, DiffStatus> = { ...diffIndex(reviewBaseIndex, reviewWorkspaceIndex) }
    for (const change of captureChanges) {
      next[`capture:${change.testFile}::${change.exportName}`] = change.status
      const componentTarget = `component:${change.component}`
      next[componentTarget] = combineDiffStatus(next[componentTarget], change.status) ?? change.status
    }
    return next
  }, [activeWorkspaceId, captureChanges, reviewWorkspaceIndex, reviewBaseIndex])

  const activeWs = workspaces.find((w) => w.id === activeWorkspaceId)
  const activeGoals = activeWs?.goals ?? []
  const activeStorybookRenderKey = `${activeWs?.activeArcWsInstanceId ?? activeWs?.activeImplWsInstanceId ?? ""}:${activeStorybookState?.startedAt ?? 0}`

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
        setWorkspaceReviewIndex(selectWorkspaceReviewIndex(ws))
        setWorkspaceOutcomeBaselineIndex(selectWorkspaceOutcomeBaseIndex(index, ws))
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
        setWorkspaceReviewIndex(selectWorkspaceReviewIndex(ws))
        setWorkspaceBaselineIndex(selectWorkspaceReviewBaseIndex(index, ws))
        setWorkspaceOutcomeBaselineIndex(selectWorkspaceOutcomeBaseIndex(index, ws))
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
    const suggested = branchNameFromWorkspace(workspace?.name ?? "workspace")
    const branchName = window.prompt("Branch name for the pull request", suggested)?.trim()
    if (!branchName) return

    setBusy(`creating PR for ${branchName}…`)
    try {
      const res = await fetch(`/api/workspaces/${id}/push-branch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ branchName }),
      })
      const data = await res.json().catch(() => ({})) as {
        error?: string
        remote?: string
        branchName?: string
        changed?: boolean
        pullRequest?: { url: string; number: number | null; created: boolean }
      }
      if (!res.ok) {
        window.alert(data.error ?? "Failed to create pull request")
        return
      }
      const pushedBranch = data.branchName ?? branchName
      const remote = data.remote ?? "origin"
      const prUrl = data.pullRequest?.url
      if (prUrl) {
        window.open(prUrl, "_blank", "noopener,noreferrer")
        window.alert(`${data.pullRequest?.created === false ? "Opened existing" : "Created"} PR for ${remote}/${pushedBranch}\n${prUrl}`)
      } else {
        window.alert(`Pushed ${remote}/${pushedBranch}, but no PR URL was returned`)
      }
    } finally {
      setBusy(null)
    }
  }, [workspaces])

  const deleteGoal = useCallback(
    async (wsId: string, goalId: string) => {
      await fetch(`/api/workspaces/${wsId}/goals/${goalId}`, { method: "DELETE" })
      setSelected((s) => (s?.type === "goal" && s.id === goalId ? null : s))
      await refreshWorkspaces()
    },
    [refreshWorkspaces]
  )

  // Boot
  const bootedRef = useRef(false)
  useEffect(() => {
    if (bootedRef.current) return
    bootedRef.current = true
    ;(async () => {
      await Promise.all([refresh(), refreshTests(), refreshStorybooks(), refreshDemos()])
      const wsRes = await fetch("/api/workspaces").catch(() => null)
      const wsList = wsRes?.ok ? ((await wsRes.json()) as WorkspaceMeta[]) : []
      setWorkspaces(wsList)
      setWorkspacesLoading(false)
      if (wsList.length > 0) {
        const latest = wsList.sort((a, b) => b.createdAt - a.createdAt)[0]
        if (latest != null) await openWorkspace(latest.id)
      } else {
        await createWorkspace()
      }
    })()
    const iv = setInterval(() => { refreshTests(); refreshStorybooks() }, 2_000)
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

  const agentEvents = agentGoalId ? goalEvents[agentGoalId] ?? [] : []
  const agentRunning = agentGoalId ? effectiveRunningGoals.has(agentGoalId) : false

  const loadSessionForGoal = useCallback(async (goalId: string) => {
    if (goalEvents[goalId]?.length) {
      setAgentGoalId(goalId)
      setAgentOpen(true)
      return
    }
    try {
      const res = await fetch(`/api/sessions?goal=${goalId}`)
      if (!res.ok) { setAgentGoalId(goalId); setAgentOpen(true); return }
      const data = await res.json() as { events: { type: string; payload: string }[] }
      const msgs: AgentMsg[] = data.events.map((e) => JSON.parse(e.payload) as AgentMsg)
      setGoalEvents((prev) => ({ ...prev, [goalId]: msgs }))
      setAgentGoalId(goalId)
      setAgentOpen(true)
    } catch {
      setAgentGoalId(goalId)
      setAgentOpen(true)
    }
  }, [goalEvents])

  const runAgent = useCallback(
    (wsId: string, goalId?: string) => {
      if (!goalId) return
      setGoalEvents((prev) => ({ ...prev, [goalId]: [] }))
      setRunningGoals((prev) => new Set(prev).add(goalId))
      setAgentGoalId(goalId)
      setAgentOpen(true)
      const openStream = (attempt: number) => {
        let receivedMessage = false
        let terminal = false
        const es = new EventSource(`/api/agent/run?workspace=${encodeURIComponent(wsId)}&goal=${encodeURIComponent(goalId)}`)
        esRefs.current.set(goalId, es)
        es.onmessage = (m) => {
          receivedMessage = true
          const msg = JSON.parse(m.data) as AgentMsg
          setGoalEvents((prev) => ({ ...prev, [goalId]: [...(prev[goalId] ?? []), msg] }))
          if (msg.type === "done" || msg.type === "error") {
            terminal = true
            es.close()
            esRefs.current.delete(goalId)
            setRunningGoals((prev) => { const next = new Set(prev); next.delete(goalId); return next })
            Promise.all([refreshWorkspaces(), refreshTests(), refreshStorybooks()]).then(() => openWorkspace(wsId))
          }
        }
        es.onerror = () => {
          if (terminal) return
          es.close()
          esRefs.current.delete(goalId)
          if (!receivedMessage && attempt < 1) {
            setGoalEvents((prev) => ({
              ...prev,
              [goalId]: [...(prev[goalId] ?? []), { type: "status", message: "agent stream disconnected; retrying…" }],
            }))
            window.setTimeout(() => openStream(attempt + 1), 750)
            return
          }
          setGoalEvents((prev) => ({
            ...prev,
            [goalId]: [...(prev[goalId] ?? []), { type: "error", message: "agent stream disconnected" }],
          }))
          setRunningGoals((prev) => { const next = new Set(prev); next.delete(goalId); return next })
          Promise.all([refreshWorkspaces(), refreshTests(), refreshStorybooks()]).then(() => openWorkspace(wsId))
        }
      }
      openStream(0)
    },
    [refreshWorkspaces, refreshTests, refreshStorybooks, openWorkspace]
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
    setWorkspaceReviewIndex(null)
    setWorkspaceOutcomeBaselineIndex(null)
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
        setWorkspaceReviewIndex(selectWorkspaceReviewIndex(ws))
        setWorkspaceOutcomeBaselineIndex(selectWorkspaceOutcomeBaseIndex(index, ws))
        setActiveWorkspaceId(ws.id)
        setSelection({ file: ws.index.files[0]?.file ?? "", view: "code" })
      }
      await Promise.all([refreshTests(), refreshStorybooks()])
    } finally {
      setBusy(null)
    }
  }, [refreshTests, refreshStorybooks])

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
      extra?: { storyId?: string; selector?: string; component?: string },
    ) => {
      // 1. Code forks are created client-side. Arch isolation is owned by the backend.
      let wsId = fork && mode === "code" ? await createWorkspace(activeWorkspaceId, "code") : activeWorkspaceId
      if (!wsId) wsId = await createWorkspace(null, "code")
      if (!wsId) return

      // 2. Add goal to workspace queue
      const goalRes = await fetch(`/api/workspaces/${wsId}/goals`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target, label, text, mode, fork, ...extra }),
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

      // 3. Trigger agent to process the queue
      runAgent(goalWsId, goal.id)
    },
    [activeWorkspaceId, createWorkspace, refreshWorkspaces, runAgent]
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
      }))
    return { type: "logos:story-goals", goals: storyGoals, workspaceKind: activeWs?.kind ?? "code" }
  }, [activeGoals, activeWs?.kind])

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
      if (e.data?.type !== "logos:story-comment") return
      const { storyId, component, selector, label, text, mode, fork } = e.data
      const target = component ? `component:${component}` : `story:${storyId}`
      addGoal(target, label ?? storyId, text, mode ?? "code", fork ?? false, { storyId, selector, component })
    }
    window.addEventListener("message", onMsg)
    return () => window.removeEventListener("message", onMsg)
  }, [addGoal, postStoryGoals])

  // Push goals to Storybook iframes so they can render pins
  useEffect(() => {
    postStoryGoals()
  }, [postStoryGoals])

  const currentFile = view.files.find((f) => f.file === selection.file) ?? view.files[0]

  function setView(viewName: View) {
    if (!currentFile) return
    const components = componentsOf(currentFile)
    const comp = selection.component
      ? components.find((candidate) => candidate.name === selection.component) ?? components[0]
      : selection.storyId
        ? components.find((candidate) => candidate.stories.some((story) => story.id === selection.storyId)) ?? components[0]
        : components[0]
    if (viewName === "story" && comp) {
      const storyId = selection.storyId ?? comp.stories[0]?.id
      setSelection({ file: currentFile.file, component: comp.name, view: viewName, ...(storyId != null ? { storyId } : {}) })
    } else if (viewName === "captured" && comp) {
      const exportName = selection.exportName ?? comp.captured[0]?.exportName
      setSelection({
        file: currentFile.file,
        component: comp.name,
        view: viewName,
        ...(exportName != null ? { exportName } : {}),
      })
    } else {
      setSelection({ file: currentFile.file, ...(comp ? { component: comp.name } : {}), view: viewName })
    }
  }

  const onCapture = useCallback(
    async (storyId: string) => {
      const found = view.files.flatMap((file) =>
        componentsOf(file).map((component) => ({ file, component }))
      ).find(({ component }) => component.stories.some((s) => s.id === storyId))
      const story = found?.component.stories.find((s) => s.id === storyId)
      if (!found || !story) return
      setBusy(`capturing ${found.component.name}/${story.exportName}…`)
      setCaptureError(null)
      try {
        const res = await fetch("/api/capture", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ storyRef: storyId, workspaceId: activeWorkspaceId }),
        })
        if (res.ok) {
          await reindexWorkspace(activeWorkspaceId)
          setSelection({ file: found.file.file, component: found.component.name, view: "captured", exportName: story.exportName })
        } else {
          const data = await res.json().catch(() => null) as { error?: string } | null
          setCaptureError(data?.error ? `Capture failed: ${data.error}` : `Capture failed (${res.status})`)
        }
      } catch (e) {
        setCaptureError(`Capture failed: ${String(e)}`)
      } finally {
        setBusy(null)
      }
    },
    [view.files, activeWorkspaceId, reindexWorkspace]
  )

  const nComps = view.files.reduce((n, f) => n + componentsOf(f).length, 0)
  const totalGoals = workspaces.reduce((n, w) => n + (w.goals?.length ?? 0), 0)
  const captureReviewCount = captureChanges.length
  const reviewCount = captureReviewCount + (
    reviewWorkspaceIndex && indexToArchText(reviewBaseIndex) !== indexToArchText(reviewWorkspaceIndex) ? 1 : 0
  )
  const activeDemo = demos.find((d) => d.id === activeDemoId)
  const demoLabel = demoSwitching
    ? `Opening ${demos.find((d) => d.id === demoSwitching)?.name ?? demoSwitching}`
    : activeDemo?.name ?? "Custom"

  if (!activeWorkspaceId || !workspaceIndex) {
    return (
      <div className="studio">
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
    <div className={`studio ${railOpen ? "rail-open" : "rail-closed"}`}>
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
        onSelectGoal={(id) => { setSelected({ type: "goal", id }); loadSessionForGoal(id) }}
        onDeleteWorkspace={deleteWorkspace}
        onDeleteGoal={deleteGoal}
        runningGoals={effectiveRunningGoals}
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
        </div>
        <SidebarTree
          files={view.files}
          selection={selection}
          onSelect={onSelect}
          comments={goalsByTarget}
          onComment={openComment}
          diff={diff}
          testState={testState}
          showFunctions={sidebarFilters.functions}
          showClasses={sidebarFilters.classes}
          showComponents={sidebarFilters.components}
        />
      </aside>

      <main className="main">
        <nav className="main-nav">
          <button className={!reviewOpen ? "active" : ""} onClick={() => setReviewOpen(false)}>
            Workspace
          </button>
          <button className={reviewOpen ? "active" : ""} onClick={() => setReviewOpen(true)}>
            Review{reviewCount > 0 ? ` ${reviewCount}` : ""}
          </button>
        </nav>
        <div className="main-view">
          {reviewOpen ? (
            <ReviewPanel
              base={reviewBaseIndex}
              workspace={reviewWorkspaceIndex ?? workspaceIndex}
              captureBase={outcomeBaseIndex}
              captureWorkspace={workspaceIndex}
              storybookUrl={activeStorybookUrl}
              storybookState={activeStorybookState}
              onRetryStorybook={retryStorybook}
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
              onRetryStorybook={retryStorybook}
              onView={setView}
              onCapture={onCapture}
              comments={goalsByTarget}
              onComment={openComment}
              diff={diff}
            />
          ) : (
            <div className="empty">No files indexed.</div>
          )}
        </div>
        {agentOpen && (
          <AgentPanel events={agentEvents} running={agentRunning} goal={activeGoals.find(g => g.id === agentGoalId) ?? null} onClose={closeAgent} />
        )}
      </main>

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
            captureError ? <span className="status-error">{captureError}</span> : busy ??
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
          onAdd={(text, mode, fork) => { addGoal(popup.target, popup.label, text, mode, fork); setPopup(null) }}
          onClose={() => setPopup(null)}
        />
      )}
    </div>
  )
}
