import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { StoryTree } from "./StoryTree"
import { BackendTree } from "./BackendTree"
import { ContentPanel } from "./ContentPanel"
import { BackendPanel } from "./BackendPanel"
import { CommentPopup } from "./CommentPopup"
import { ChangesRail } from "./ChangesRail"
import { AgentPanel, type AgentMsg } from "./AgentPanel"
import { diffIndex } from "./diff"
import type {
  BackendSel,
  Comment,
  Selection,
  StudioIndex,
  View,
  Workspace,
  WorkspaceMeta,
} from "./types"
import seedData from "./studio-index.json"

const seed = seedData as unknown as StudioIndex

export function App() {
  const [index, setIndex] = useState<StudioIndex>(seed)
  const [busy, setBusy] = useState<string | null>(null)
  const [active, setActive] = useState<"component" | "backend">("component")
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(seed.components[0] ? [seed.components[0].name] : [])
  )
  const [selection, setSelection] = useState<Selection>({
    comp: seed.components[0]?.name ?? "",
    view: "code",
  })
  const [backendSel, setBackendSel] = useState<BackendSel | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [popup, setPopup] = useState<{ target: string; label: string; x: number; y: number } | null>(
    null
  )

  // ---- workspaces (forks) ----
  const [railOpen, setRailOpen] = useState(true)
  const [workspaces, setWorkspaces] = useState<WorkspaceMeta[]>([])
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null)
  const [workspaceIndex, setWorkspaceIndex] = useState<StudioIndex | null>(null)
  const [selected, setSelected] = useState<{ type: "workspace" | "comment"; id: string } | null>(
    null
  )

  // The index the whole studio renders: base, or the active forked copy.
  const view = activeWorkspaceId && workspaceIndex ? workspaceIndex : index

  // Node-level diff of the active workspace vs base (drives highlight colors).
  const diff = useMemo(
    () => (activeWorkspaceId && workspaceIndex ? diffIndex(index, workspaceIndex) : {}),
    [activeWorkspaceId, workspaceIndex, index]
  )

  // Only the active workspace's comments are shown on nodes — per-workspace isolation.
  const commentsByTarget = useMemo(() => {
    const m: Record<string, Comment[]> = {}
    for (const c of comments) if (c.workspaceId === activeWorkspaceId) (m[c.target] ??= []).push(c)
    return m
  }, [comments, activeWorkspaceId])

  const refreshComments = useCallback(async () => {
    try {
      const res = await fetch("/api/comments")
      if (res.ok) setComments((await res.json()) as Comment[])
    } catch {
      /* no dev server */
    }
  }, [])
  const refreshWorkspaces = useCallback(async () => {
    try {
      const res = await fetch("/api/workspaces")
      if (res.ok) setWorkspaces((await res.json()) as WorkspaceMeta[])
    } catch {
      /* no dev server */
    }
  }, [])
  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/index")
      if (res.ok) setIndex((await res.json()) as StudioIndex)
    } catch {
      /* static seed remains */
    }
  }, [])
  useEffect(() => {
    refresh()
    refreshComments()
    refreshWorkspaces()
  }, [refresh, refreshComments, refreshWorkspaces])

  const openWorkspace = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/workspaces/${id}`)
      if (res.ok) {
        const ws = (await res.json()) as Workspace
        setWorkspaceIndex(ws.index)
        setActiveWorkspaceId(id)
      }
    } catch {
      /* ignore */
    }
  }, [])

  const onBase = useCallback(() => {
    setActiveWorkspaceId(null)
    setWorkspaceIndex(null)
  }, [])

  // Create a workspace — branch from `fromWorkspaceId`, or snapshot base — and switch to it.
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
      if (activeWorkspaceId === id) {
        setActiveWorkspaceId(null)
        setWorkspaceIndex(null)
      }
      setSelected((s) => (s?.type === "workspace" && s.id === id ? null : s))
      await Promise.all([refreshWorkspaces(), refreshComments()])
    },
    [activeWorkspaceId, refreshWorkspaces, refreshComments]
  )
  const deleteComment = useCallback(
    async (id: string) => {
      await fetch(`/api/comments/${id}`, { method: "DELETE" })
      setSelected((s) => (s?.type === "comment" && s.id === id ? null : s))
      await refreshComments()
    },
    [refreshComments]
  )

  // Cmd/Ctrl+Backspace deletes the selection (comment or workspace), else the active workspace.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Backspace") {
        const tag = (e.target as HTMLElement)?.tagName
        if (tag === "TEXTAREA" || tag === "INPUT") return
        const sel = selected ?? (activeWorkspaceId ? { type: "workspace" as const, id: activeWorkspaceId } : null)
        if (!sel) return
        e.preventDefault()
        if (sel.type === "workspace") deleteWorkspace(sel.id)
        else deleteComment(sel.id)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [selected, activeWorkspaceId, deleteWorkspace, deleteComment])

  // ---- agents run automatically/declaratively: a change on a workspace ⇒ an
  // agent is working it. No manual trigger. ----
  const [agentEvents, setAgentEvents] = useState<AgentMsg[]>([])
  const [agentRunning, setAgentRunning] = useState(false)
  const [agentWorkspace, setAgentWorkspace] = useState<string | null>(null)
  const [agentOpen, setAgentOpen] = useState(false)
  const esRef = useRef<EventSource | null>(null)
  const runningWsRef = useRef<string | null>(null)
  const pendingRef = useRef<Set<string>>(new Set())

  const runAgent = useCallback(
    (wsId: string, runMode: "code" | "arch") => {
      esRef.current?.close()
      runningWsRef.current = wsId
      setAgentEvents([])
      setAgentRunning(true)
      setAgentWorkspace(wsId)
      setAgentOpen(true) // auto-open the terminal when an agent starts
      const es = new EventSource(`/api/agent/run?workspace=${wsId}&mode=${runMode}`)
      esRef.current = es
      es.onmessage = (m) => {
        const msg = JSON.parse(m.data) as AgentMsg
        setAgentEvents((prev) => [...prev, msg])
        if (msg.type === "done" || msg.type === "error") {
          es.close()
          setAgentRunning(false)
          runningWsRef.current = null
          refreshWorkspaces().then(() => openWorkspace(wsId)) // re-load → diff updates
          if (pendingRef.current.has(wsId)) {
            // changes arrived mid-run — reconcile again
            pendingRef.current.delete(wsId)
            setTimeout(() => runAgent(wsId, runMode), 300)
          }
        }
      }
      es.onerror = () => {
        es.close()
        setAgentRunning(false)
        runningWsRef.current = null
      }
    },
    [refreshWorkspaces, openWorkspace]
  )
  // Declarative reconcile: ensure an agent is working `wsId` in the comment's mode.
  const ensureAgent = useCallback(
    (wsId: string, runMode: "code" | "arch") => {
      if (runningWsRef.current === wsId) pendingRef.current.add(wsId)
      else runAgent(wsId, runMode)
    },
    [runAgent]
  )
  // Closing just hides the terminal; the last run's log + a running agent persist.
  const closeAgent = useCallback(() => setAgentOpen(false), [])

  // Fork = branch the current workspace (or base) into a parallel copy.
  const onFork = useCallback(async () => {
    setBusy("forking workspace…")
    try {
      await createWorkspace(activeWorkspaceId)
    } finally {
      setBusy(null)
    }
  }, [createWorkspace, activeWorkspaceId])

  const toggleExpanded = useCallback((name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
  }, [])

  const selectComponent = useCallback((sel: Selection) => {
    setActive("component")
    setSelection(sel)
  }, [])

  const selectBackend = useCallback((sel: BackendSel) => {
    setActive("backend")
    setBackendSel(sel)
  }, [])

  const openComment = useCallback(
    (target: string, label: string, x: number, y: number) => setPopup({ target, label, x, y }),
    []
  )
  const addComment = useCallback(
    async (target: string, label: string, text: string, mode: "code" | "arch", fork: boolean) => {
      // Default: land on the current workspace (from Base, spin one up). With fork on,
      // branch a new workspace from the current one so this change is isolated.
      let wsId = activeWorkspaceId
      if (fork || !wsId) wsId = await createWorkspace(wsId ?? undefined)
      await fetch("/api/comments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target, label, text, mode, workspaceId: wsId }),
      })
      await refreshComments()
      if (wsId) ensureAgent(wsId, mode) // the change is declared → an agent starts addressing it in its mode
    },
    [activeWorkspaceId, createWorkspace, refreshComments, ensureAgent]
  )

  const components = view.components
  const current = components.find((c) => c.name === selection.comp) ?? components[0]
  const activeWs = workspaces.find((w) => w.id === activeWorkspaceId)

  function setView(viewName: View) {
    if (!current) return
    if (viewName === "story") {
      setSelection({ comp: current.name, view: viewName, storyId: selection.storyId ?? current.stories[0]?.id })
    } else if (viewName === "captured") {
      setSelection({
        comp: current.name,
        view: viewName,
        exportName: selection.exportName ?? current.captured[0]?.exportName,
      })
    } else {
      setSelection({ comp: current.name, view: viewName })
    }
  }

  const onCapture = useCallback(
    async (storyId: string) => {
      const comp = components.find((c) => c.stories.some((s) => s.id === storyId))
      const story = comp?.stories.find((s) => s.id === storyId)
      if (!comp || !story) return
      setBusy(`capturing ${comp.name}/${story.exportName}…`)
      try {
        const res = await fetch("/api/capture", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ storyRef: storyId }),
        })
        if (res.ok) {
          await refresh()
          setSelection({ comp: comp.name, view: "captured", exportName: story.exportName })
        }
      } finally {
        setBusy(null)
      }
    },
    [components, refresh]
  )

  return (
    <div className={`studio ${railOpen ? "rail-open" : "rail-closed"}`}>
      <ChangesRail
        open={railOpen}
        onToggle={() => setRailOpen((o) => !o)}
        comments={comments}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        selected={selected}
        onBase={() => {
          setSelected(null)
          onBase()
        }}
        onNewWorkspace={() => createWorkspace()}
        onOpenWorkspace={(id) => {
          setSelected({ type: "workspace", id })
          openWorkspace(id)
        }}
        onFork={onFork}
        onSelectComment={(id) => setSelected({ type: "comment", id })}
        onDeleteWorkspace={deleteWorkspace}
        onDeleteComment={deleteComment}
        agentRunning={agentRunning}
        agentWorkspace={agentWorkspace}
      />

      <aside className="sidebar">
        <StoryTree
          components={components}
          selection={selection}
          active={active === "component"}
          expanded={expanded}
          onSelect={selectComponent}
          onToggle={toggleExpanded}
          diff={diff}
        />
        <BackendTree
          backend={view.backend}
          active={active === "backend"}
          selection={backendSel}
          onSelect={selectBackend}
          comments={commentsByTarget}
          onComment={openComment}
          diff={diff}
        />
      </aside>

      <main className="main">
        {active === "backend" && backendSel ? (
          <BackendPanel
            backend={view.backend}
            selection={backendSel}
            comments={commentsByTarget}
            onComment={openComment}
            diff={diff}
          />
        ) : current ? (
          <ContentPanel
            component={current}
            selection={selection}
            storybookUrl={index.storybookUrl}
            onView={setView}
            onCapture={onCapture}
            comments={commentsByTarget}
            onComment={openComment}
            diff={diff}
          />
        ) : (
          <div className="empty">No components indexed.</div>
        )}
        {agentOpen && (
          <AgentPanel events={agentEvents} running={agentRunning} onClose={closeAgent} />
        )}
      </main>

      <footer className="statusbar">
        <span>
          {activeWs ? (
            <>
              ⑂ {activeWs.name}{" "}
              <a className="exit-ws" onClick={onBase}>
                exit to base
              </a>
            </>
          ) : (
            `logos-ts · ${index.root.split("/").pop()}`
          )}
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
          {busy ??
            `${components.length} components · ${view.backend.length} backend files · ${comments.length} comments · ${workspaces.length} workspaces`}
        </span>
      </footer>

      {popup && (
        <CommentPopup
          x={popup.x}
          y={popup.y}
          label={popup.label}
          comments={commentsByTarget[popup.target] ?? []}
          onAdd={(text, mode, fork) => addComment(popup.target, popup.label, text, mode, fork)}
          onClose={() => setPopup(null)}
        />
      )}
    </div>
  )
}
