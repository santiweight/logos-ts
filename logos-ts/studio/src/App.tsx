/* eslint-disable @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unnecessary-condition, no-restricted-syntax */
import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { SidebarTree } from "./SidebarTree"
import { ContentPanel } from "./ContentPanel"
import { CommentPopup } from "./CommentPopup"
import { ChangesRail } from "./ChangesRail"
import { svgIcon } from "./icons"
import { AgentPanel, type AgentMsg } from "./AgentPanel"
import { ArchDiffPanel } from "./ArchDiffPanel"
import { diffIndex } from "./diff"
import type {
  Goal,
  SbState,
  Selection,
  StudioIndex,
  TestState,
  View,
  Workspace,
  WorkspaceMeta,
} from "./types"
import seedData from "./studio-index.json"

const seed = seedData as unknown as StudioIndex

export function App() {
  const [index, setIndex] = useState<StudioIndex>(seed)
  const [busy, setBusy] = useState<string | null>(null)
  const [selection, setSelection] = useState<Selection>({
    file: seed.files[0]?.file ?? "",
    view: "code",
  })
  const [popup, setPopup] = useState<{ target: string; label: string; x: number; y: number } | null>(
    null
  )

  // ---- workspaces (forks) ----
  const [railOpen, setRailOpen] = useState(true)
  const [workspaces, setWorkspaces] = useState<WorkspaceMeta[]>([])
  const [workspacesLoading, setWorkspacesLoading] = useState(true)
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null)
  const [workspaceIndex, setWorkspaceIndex] = useState<StudioIndex | null>(null)
  const [selected, setSelected] = useState<{ type: "workspace" | "goal"; id: string } | null>(null)

  const view: StudioIndex = workspaceIndex ?? { root: "", files: [] }

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
  const retryStorybook = useCallback(async () => {
    if (!activeWorkspaceId) return
    try {
      await fetch(`/api/workspaces/${activeWorkspaceId}/storybook`, { method: "POST" })
    } catch {}
    refreshStorybooks()
  }, [activeWorkspaceId, refreshStorybooks])

  const diff = useMemo(
    () => (activeWorkspaceId && workspaceIndex ? diffIndex(index, workspaceIndex) : {}),
    [activeWorkspaceId, workspaceIndex, index]
  )

  const activeWs = workspaces.find((w) => w.id === activeWorkspaceId)
  const activeGoals = activeWs?.goals ?? []

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

  const openWorkspace = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/workspaces/${id}`)
      if (res.ok) {
        const ws = (await res.json()) as Workspace
        setWorkspaceIndex(ws.index)
        setActiveWorkspaceId(id)
      }
    } catch {}
  }, [])

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
    async (fromWorkspaceId?: string | null): Promise<string | null> => {
      try {
        const res = await fetch("/api/workspaces", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ fromWorkspaceId: fromWorkspaceId ?? undefined }),
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
      await Promise.all([refresh(), refreshTests(), refreshStorybooks()])
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

  const [archDiffOpen, setArchDiffOpen] = useState(false)

  // ---- agent (per-goal) ----
  const [goalEvents, setGoalEvents] = useState<Record<string, AgentMsg[]>>({})
  const [runningGoals, setRunningGoals] = useState<Set<string>>(new Set())
  const [agentOpen, setAgentOpen] = useState(false)
  const [agentGoalId, setAgentGoalId] = useState<string | null>(null)
  const esRefs = useRef<Map<string, EventSource>>(new Map())

  const agentEvents = agentGoalId ? goalEvents[agentGoalId] ?? [] : []
  const agentRunning = agentGoalId ? runningGoals.has(agentGoalId) : false

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
      const es = new EventSource(`/api/agent/run?workspace=${wsId}`)
      esRefs.current.set(goalId, es)
      es.onmessage = (m) => {
        const msg = JSON.parse(m.data) as AgentMsg
        setGoalEvents((prev) => ({ ...prev, [goalId]: [...(prev[goalId] ?? []), msg] }))
        if (msg.type === "done" || msg.type === "error") {
          es.close()
          esRefs.current.delete(goalId)
          setRunningGoals((prev) => { const next = new Set(prev); next.delete(goalId); return next })
          Promise.all([refreshWorkspaces(), refreshTests()]).then(() => openWorkspace(wsId))
        }
      }
      es.onerror = () => {
        es.close()
        esRefs.current.delete(goalId)
        setRunningGoals((prev) => { const next = new Set(prev); next.delete(goalId); return next })
      }
    },
    [refreshWorkspaces, refreshTests, openWorkspace]
  )
  const closeAgent = useCallback(() => setAgentOpen(false), [])

  // Poll workspace index while agent is running
  useEffect(() => {
    if (!agentRunning || !agentWorkspace) return
    const iv = setInterval(() => openWorkspace(agentWorkspace), 3_000)
    return () => clearInterval(iv)
  }, [agentRunning, agentWorkspace, openWorkspace])

  // ---- actions ----
  const onFork = useCallback(async () => {
    setBusy("forking workspace…")
    try { await createWorkspace(activeWorkspaceId) } finally { setBusy(null) }
  }, [createWorkspace, activeWorkspaceId])

  const onSelect = useCallback((sel: Selection) => setSelection(sel), [])

  const openComment = useCallback(
    (target: string, label: string, x: number, y: number) => setPopup({ target, label, x, y }),
    []
  )

  const addGoal = useCallback(
    async (
      target: string, label: string, text: string, mode: "code" | "arch", fork: boolean,
      extra?: { storyId?: string; selector?: string; component?: string },
    ) => {
      // 1. Create workspace if forking or if none exists
      let wsId = fork ? await createWorkspace(activeWorkspaceId) : activeWorkspaceId
      if (!wsId) wsId = await createWorkspace()
      if (!wsId) return

      // 2. Add goal to workspace queue
      const goalRes = await fetch(`/api/workspaces/${wsId}/goals`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target, label, text, mode, ...extra }),
      })
      const goal = goalRes.ok ? await goalRes.json() as Goal : null
      await refreshWorkspaces()

      // 3. Trigger agent to process the queue
      runAgent(wsId, goal?.id)
    },
    [activeWorkspaceId, createWorkspace, refreshWorkspaces, runAgent]
  )

  // Listen for story comments from Storybook iframe
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type !== "logos:story-comment") return
      const { storyId, component, selector, label, text, mode } = e.data
      const target = component ? `component:${component}` : `story:${storyId}`
      addGoal(target, label ?? storyId, text, mode ?? "code", false, { storyId, selector, component })
    }
    window.addEventListener("message", onMsg)
    return () => window.removeEventListener("message", onMsg)
  }, [addGoal])

  // Push goals to Storybook iframes so they can render pins
  useEffect(() => {
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
    const msg = { type: "logos:story-goals", goals: storyGoals }
    document.querySelectorAll<HTMLIFrameElement>("iframe.story-frame").forEach((f) => {
      try { f.contentWindow?.postMessage(msg, "*") } catch {}
    })
  }, [activeGoals])

  const currentFile = view.files.find((f) => f.file === selection.file) ?? view.files[0]

  function setView(viewName: View) {
    if (!currentFile) return
    const comp = currentFile.component
    if (viewName === "story" && comp) {
      const storyId = selection.storyId ?? comp.stories[0]?.id
      setSelection({ file: currentFile.file, view: viewName, ...(storyId != null ? { storyId } : {}) })
    } else if (viewName === "captured" && comp) {
      const exportName = selection.exportName ?? comp.captured[0]?.exportName
      setSelection({
        file: currentFile.file,
        view: viewName,
        ...(exportName != null ? { exportName } : {}),
      })
    } else {
      setSelection({ file: currentFile.file, view: viewName })
    }
  }

  const onCapture = useCallback(
    async (storyId: string) => {
      const fe = view.files.find((f) => f.component?.stories.some((s) => s.id === storyId))
      const story = fe?.component?.stories.find((s) => s.id === storyId)
      if (!fe || !story) return
      setBusy(`capturing ${fe.component!.name}/${story.exportName}…`)
      try {
        const res = await fetch("/api/capture", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ storyRef: storyId }),
        })
        if (res.ok) {
          await refresh()
          setSelection({ file: fe.file, view: "captured", exportName: story.exportName })
        }
      } finally {
        setBusy(null)
      }
    },
    [view.files, refresh]
  )

  const nComps = view.files.filter((f) => f.component).length
  const totalGoals = workspaces.reduce((n, w) => n + (w.goals?.length ?? 0), 0)

  if (!activeWorkspaceId || !workspaceIndex) {
    return <div className="studio"><div className="empty">Opening workspace…</div></div>
  }

  return (
    <div className={`studio ${railOpen ? "rail-open" : "rail-closed"}`}>
      <ChangesRail
        open={railOpen}
        onToggle={() => setRailOpen((o) => !o)}
        workspaces={workspaces}
        workspacesLoading={workspacesLoading}
        activeWorkspaceId={activeWorkspaceId}
        selected={selected}
        onNewWorkspace={() => createWorkspace()}
        onOpenWorkspace={(id) => {
          setSelected({ type: "workspace", id })
          openWorkspace(id)
        }}
        onFork={onFork}
        onSelectGoal={(id) => { setSelected({ type: "goal", id }); loadSessionForGoal(id) }}
        onDeleteWorkspace={deleteWorkspace}
        onDeleteGoal={deleteGoal}
        runningGoals={runningGoals}
      />

      <aside className="sidebar">
        <SidebarTree
          files={view.files}
          selection={selection}
          onSelect={onSelect}
          comments={goalsByTarget}
          onComment={openComment}
          diff={diff}
          testState={testState}
        />
      </aside>

      <main className="main">
        {archDiffOpen ? (
          <ArchDiffPanel
            base={index}
            workspace={workspaceIndex}
            onClose={() => setArchDiffOpen(false)}
          />
        ) : currentFile ? (
          <ContentPanel
            file={currentFile}
            selection={selection}
            storybookUrl={activeStorybookUrl}
            storybookState={activeStorybookState}
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
        {agentOpen && (
          <AgentPanel events={agentEvents} running={agentRunning} goal={activeGoals.find(g => g.id === agentGoalId) ?? null} onClose={closeAgent} />
        )}
      </main>

      <footer className="statusbar">
        <span>
          {svgIcon("M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9", 11)}{" "}
          {activeWs?.name ?? "workspace"}{" "}
          <a className="refresh-btn" onClick={() => reindexWorkspace()} title="Re-index workspace from disk">↻</a>{" "}
          <a className="arch-diff-toggle" onClick={() => setArchDiffOpen((o) => !o)}>
            {archDiffOpen ? "close diff" : "arch diff"}
          </a>
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
          {busy ??
            `${view.files.length} files · ${nComps} components · ${totalGoals} goals · ${workspaces.length} workspaces`}
        </span>
      </footer>

      {popup && (
        <CommentPopup
          x={popup.x}
          y={popup.y}
          label={popup.label}
          goals={goalsByTarget[popup.target] ?? []}
          onAdd={(text, mode, fork) => { addGoal(popup.target, popup.label, text, mode, fork); setPopup(null) }}
          onClose={() => setPopup(null)}
        />
      )}
    </div>
  )
}
