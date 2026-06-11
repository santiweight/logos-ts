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
  Comment,
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
  const [comments, setComments] = useState<Comment[]>([])
  const [popup, setPopup] = useState<{ target: string; label: string; x: number; y: number } | null>(
    null
  )

  // ---- workspaces (forks) ----
  const [railOpen, setRailOpen] = useState(true)
  const [workspaces, setWorkspaces] = useState<WorkspaceMeta[]>([])
  const [workspacesLoading, setWorkspacesLoading] = useState(true)
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null)
  const [workspaceIndex, setWorkspaceIndex] = useState<StudioIndex | null>(null)
  const [selected, setSelected] = useState<{ type: "workspace" | "comment"; id: string } | null>(
    null
  )

  const view = activeWorkspaceId && workspaceIndex ? workspaceIndex : index

  const diff = useMemo(
    () => (activeWorkspaceId && workspaceIndex ? diffIndex(index, workspaceIndex) : {}),
    [activeWorkspaceId, workspaceIndex, index]
  )

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
      setWorkspacesLoading(true)
      const res = await fetch("/api/workspaces")
      if (res.ok) setWorkspaces((await res.json()) as WorkspaceMeta[])
    } catch {
      /* no dev server */
    } finally {
      setWorkspacesLoading(false)
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
  const [testState, setTestState] = useState<TestState | null>(null)
  const refreshTests = useCallback(async () => {
    try {
      const res = await fetch("/api/test-results")
      if (res.ok) setTestState((await res.json()) as TestState)
    } catch { /* no dev server */ }
  }, [])

  useEffect(() => {
    refresh()
    refreshComments()
    refreshWorkspaces()
    refreshTests()
    const iv = setInterval(refreshTests, 2_000)
    return () => clearInterval(iv)
  }, [refresh, refreshComments, refreshWorkspaces, refreshTests])

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

  const [archDiffOpen, setArchDiffOpen] = useState(false)

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
      setAgentOpen(true)
      const es = new EventSource(`/api/agent/run?workspace=${wsId}&mode=${runMode}`)
      esRef.current = es
      es.onmessage = (m) => {
        const msg = JSON.parse(m.data) as AgentMsg
        setAgentEvents((prev) => [...prev, msg])
        if (msg.type === "done" || msg.type === "error") {
          es.close()
          setAgentRunning(false)
          runningWsRef.current = null
          Promise.all([refreshWorkspaces(), refreshTests()]).then(() => openWorkspace(wsId))
          if (pendingRef.current.has(wsId)) {
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
  const ensureAgent = useCallback(
    (wsId: string, runMode: "code" | "arch") => {
      if (runningWsRef.current === wsId) pendingRef.current.add(wsId)
      else runAgent(wsId, runMode)
    },
    [runAgent]
  )
  const closeAgent = useCallback(() => setAgentOpen(false), [])

  const adoptingRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const iv = setInterval(async () => {
      const res = await fetch("/api/comments").catch(() => null)
      if (!res?.ok) return
      const all = (await res.json()) as Comment[]
      const orphans = all.filter(
        (c) => !c.workspaceId && c.agentStatus === "pending" && !adoptingRef.current.has(c.id)
      )
      for (const c of orphans) {
        adoptingRef.current.add(c.id)
        const wsId = await createWorkspace()
        if (!wsId) { adoptingRef.current.delete(c.id); continue }
        await fetch(`/api/comments/${c.id}/workspace`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ workspaceId: wsId }),
        })
        await refreshComments()
        ensureAgent(wsId, c.mode as "code" | "arch")
      }
    }, 2_000)
    return () => clearInterval(iv)
  }, [createWorkspace, refreshComments, ensureAgent])

  const onFork = useCallback(async () => {
    setBusy("forking workspace…")
    try {
      await createWorkspace(activeWorkspaceId)
    } finally {
      setBusy(null)
    }
  }, [createWorkspace, activeWorkspaceId])

  const onSelect = useCallback((sel: Selection) => {
    setSelection(sel)
  }, [])

  const openComment = useCallback(
    (target: string, label: string, x: number, y: number) => setPopup({ target, label, x, y }),
    []
  )
  const addComment = useCallback(
    async (target: string, label: string, text: string, mode: "code" | "arch", fork: boolean) => {
      let wsId = activeWorkspaceId
      if (fork || !wsId) wsId = await createWorkspace(wsId ?? undefined)
      await fetch("/api/comments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target, label, text, mode, workspaceId: wsId }),
      })
      await refreshComments()
      if (wsId) ensureAgent(wsId, mode)
    },
    [activeWorkspaceId, createWorkspace, refreshComments, ensureAgent]
  )

  const currentFile = view.files.find((f) => f.file === selection.file) ?? view.files[0]
  const activeWs = workspaces.find((w) => w.id === activeWorkspaceId)

  function setView(viewName: View) {
    if (!currentFile) return
    const comp = currentFile.component
    if (viewName === "story" && comp) {
      setSelection({ file: currentFile.file, view: viewName, storyId: selection.storyId ?? comp.stories[0]?.id })
    } else if (viewName === "captured" && comp) {
      setSelection({
        file: currentFile.file,
        view: viewName,
        exportName: selection.exportName ?? comp.captured[0]?.exportName,
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

  return (
    <div className={`studio ${railOpen ? "rail-open" : "rail-closed"}`}>
      <ChangesRail
        open={railOpen}
        onToggle={() => setRailOpen((o) => !o)}
        comments={comments}
        workspaces={workspaces}
        workspacesLoading={workspacesLoading}
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
        <SidebarTree
          files={view.files}
          selection={selection}
          onSelect={onSelect}
          comments={commentsByTarget}
          onComment={openComment}
          diff={diff}
          testState={testState}
        />
      </aside>

      <main className="main">
        {archDiffOpen && workspaceIndex ? (
          <ArchDiffPanel
            base={index}
            workspace={workspaceIndex}
            onClose={() => setArchDiffOpen(false)}
          />
        ) : currentFile ? (
          <ContentPanel
            file={currentFile}
            selection={selection}
            storybookUrl={index.storybookUrl}
            onView={setView}
            onCapture={onCapture}
            comments={commentsByTarget}
            onComment={openComment}
            diff={diff}
          />
        ) : (
          <div className="empty">No files indexed.</div>
        )}
        {agentOpen && (
          <AgentPanel events={agentEvents} running={agentRunning} onClose={closeAgent} />
        )}
      </main>

      <footer className="statusbar">
        <span>
          {activeWs ? (
            <>
              {svgIcon("M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9", 11)} {activeWs.name}{" "}
              <a className="arch-diff-toggle" onClick={() => setArchDiffOpen((o) => !o)}>
                {archDiffOpen ? "close diff" : "arch diff"}
              </a>{" "}
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
            `${view.files.length} files · ${nComps} components · ${comments.length} comments · ${workspaces.length} workspaces`}
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
