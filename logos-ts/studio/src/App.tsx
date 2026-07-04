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
import { GotoCtx } from "./highlight"
import { diffIndex } from "./diff"
import { selectGoalReviewBaseIndex, selectReviewBaseIndex, selectWorkspaceReviewBaseIndex, selectWorkspaceReviewIndex, snapshotChanges } from "./review"
import { buildStoryWritingPrompt } from "./story-goals"
import type {
  FileEntry,
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
const SIDEBAR_FILTERS_STORAGE_KEY = "logos:sidebar-filters:v1"
type MobilePanel = "changes" | "thread" | "files" | "main"
export type WorkspaceStartupPhase = "boot" | "reset" | "idle"

export interface SidebarFilters {
  functions: boolean
  classes: boolean
  components: boolean
  types: boolean
}

const DEFAULT_SIDEBAR_FILTERS: SidebarFilters = {
  functions: false,
  classes: true,
  components: true,
  types: false,
}

export interface WorkspaceViewState {
  workspaceId: string
  index: StudioIndex
  reviewIndex: StudioIndex | null
  baselineIndex: StudioIndex
}

export function reviewChangeCount(base: StudioIndex, workspace: StudioIndex): number {
  const sourceChanged = Object.keys(diffIndex(base, workspace)).length > 0
  return (sourceChanged ? 1 : 0) + snapshotChanges(base, workspace).length
}

export function selectActiveWorkspaceView(
  state: WorkspaceViewState | null,
  activeWorkspaceId: string | null,
): WorkspaceViewState | null {
  return state?.workspaceId === activeWorkspaceId ? state : null
}

export function shouldShowProjectStartupScreen(
  workspaceUiReady: boolean,
  phase: WorkspaceStartupPhase,
): boolean {
  return phase === "reset" || (phase === "boot" && !workspaceUiReady)
}

interface DemoOption {
  id: string
  name: string
  root: string
}

interface CommentPopupState {
  target: string
  label: string
  x: number
  y: number
  storyId?: string | undefined
  selector?: string | undefined
  component?: string | undefined
  htmlContext?: string | undefined
  appPath?: string | undefined
  runTargetId?: string | undefined
  screenshotDataUrl?: string | undefined
  sourceWindow?: Window | null | undefined
}

function projectNameFromPath(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "Custom"
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

function normalizeSidebarFilters(value: unknown): SidebarFilters | null {
  if (typeof value !== "object" || value == null) return null
  const record = value as Record<string, unknown>
  return {
    functions: typeof record["functions"] === "boolean" ? record["functions"] : DEFAULT_SIDEBAR_FILTERS.functions,
    classes: typeof record["classes"] === "boolean" ? record["classes"] : DEFAULT_SIDEBAR_FILTERS.classes,
    components: typeof record["components"] === "boolean" ? record["components"] : DEFAULT_SIDEBAR_FILTERS.components,
    types: typeof record["types"] === "boolean" ? record["types"] : DEFAULT_SIDEBAR_FILTERS.types,
  }
}

function readStoredSidebarFilters(): Record<string, SidebarFilters> {
  if (typeof window === "undefined") return {}
  try {
    const raw = window.localStorage.getItem(SIDEBAR_FILTERS_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== "object" || parsed == null || Array.isArray(parsed)) return {}
    const out: Record<string, SidebarFilters> = {}
    for (const [scope, value] of Object.entries(parsed)) {
      const filters = normalizeSidebarFilters(value)
      if (filters) out[scope] = filters
    }
    return out
  } catch {
    return {}
  }
}

export function sidebarFilterScope(activeWorkspaceId: string | null, selectedGoalId: string | null): string {
  if (selectedGoalId) {
    return activeWorkspaceId ? `workspace:${activeWorkspaceId}:goal:${selectedGoalId}` : `goal:${selectedGoalId}`
  }
  return activeWorkspaceId ? `workspace:${activeWorkspaceId}` : "default"
}

export function resolveSidebarFilters(
  filtersByScope: Record<string, SidebarFilters>,
  scope: string,
): SidebarFilters {
  return filtersByScope[scope] ?? DEFAULT_SIDEBAR_FILTERS
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

export function selectActiveStorybookRuntime(
  activeWorkspaceId: string | null,
  activeWs: Pick<WorkspaceMeta, "activeInstanceId"> | undefined,
  storybookRoot: string | undefined,
  storybookUrls: Record<string, string>,
  storybookStates: Record<string, SbState>,
): { url: string; state: SbState | null } {
  const instanceId = activeWs?.activeInstanceId ?? activeWorkspaceId ?? ""
  const root = storybookRoot && storybookRoot !== "." ? storybookRoot : ""
  const key = instanceId && root ? `${instanceId}:${root}` : instanceId
  return {
    url: key ? storybookUrls[key] ?? "" : "",
    state: key ? storybookStates[key] ?? null : null,
  }
}

export function selectedStorybookRoot(files: FileEntry[], selection: Selection): string | undefined {
  if (selection.view !== "story" || !selection.storyId) return undefined
  const file = files.find((candidate) => candidate.file === selection.file) ?? files[0]
  const components = file?.components ?? (file?.component ? [file.component] : [])
  for (const component of components) {
    const story = component.stories.find((candidate) => candidate.id === selection.storyId)
    if (story) return story.storybookRoot
  }
  return undefined
}

export function workspaceReadyForDisplay(
  workspace: Pick<WorkspaceMeta, "initialization"> | null | undefined,
): boolean {
  if (!workspace) return false
  return workspace?.initialization?.status !== "initializing" && workspace?.initialization?.status !== "error"
}

function workspaceMetaFromWorkspace(ws: Workspace): WorkspaceMeta {
  const { forkDir: _forkDir, index: _index, instances: _instances, ...meta } = ws
  return meta
}

function WorkspaceStartupScreen({
  workspace,
  workspacesLoading,
  phase = "boot",
}: {
  workspace: WorkspaceMeta | undefined
  workspacesLoading: boolean
  phase?: WorkspaceStartupPhase
}) {
  const initialization = workspace?.initialization
  const hasFailed = initialization?.status === "error"

  if (phase === "reset") {
    return (
      <div className="workspace-init-fullscreen">
        <div className="workspace-init-panel">
          <div className="workspace-init-spinner" aria-hidden="true" />
          <div className="workspace-init-title">Deleting workspaces</div>
          <div className="workspace-init-steps">
            <div className="workspace-init-step running">
              <span className="workspace-init-mark"><span className="ag-spin">↻</span></span>
              <span className="workspace-init-label">Delete old workspaces</span>
            </div>
            <div className="workspace-init-step pending">
              <span className="workspace-init-mark">·</span>
              <span className="workspace-init-label">Initialize workspace</span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const projectDone = !workspacesLoading
  const wsInitializing = initialization?.status === "initializing"
  const wsDone = initialization?.status === "ready" || (!initialization && projectDone && workspace != null)

  const projectStatus: "running" | "done" = projectDone ? "done" : "running"
  const wsStatus: "pending" | "running" | "done" | "error" =
    hasFailed ? "error" : wsDone ? "done" : wsInitializing ? "running" : projectDone ? "running" : "pending"

  const activeStep = initialization?.steps?.find((s) => s.status === "running")
  const failedStep = initialization?.steps?.find((s) => s.status === "error")
  const wsDetail = hasFailed
    ? failedStep?.error ?? "Workspace initialization failed."
    : activeStep?.label ?? (wsStatus === "running" ? "Preparing workspace…" : undefined)

  return (
    <div className={`workspace-init-fullscreen ${hasFailed ? "failed" : ""}`}>
      <div className="workspace-init-panel">
        <div className="workspace-init-spinner" aria-hidden="true" />
        <div className="workspace-init-title">{hasFailed ? "Initialization failed" : "Initializing"}</div>
        <div className="workspace-init-steps">
          <div className={`workspace-init-step ${projectStatus}`}>
            <span className="workspace-init-mark">
              {projectStatus === "running" ? <span className="ag-spin">↻</span> : "✓"}
            </span>
            <span className="workspace-init-label">Load project window</span>
          </div>
          <div className={`workspace-init-step ${wsStatus}`}>
            <span className="workspace-init-mark">
              {wsStatus === "running" ? <span className="ag-spin">↻</span> : wsStatus === "done" ? "✓" : wsStatus === "error" ? "!" : "·"}
            </span>
            <span className="workspace-init-label">Initialize workspace</span>
            {wsDetail && <div className={`workspace-init-detail ${hasFailed ? "workspace-init-error" : ""}`} title={wsDetail}>{wsDetail}</div>}
          </div>
        </div>
      </div>
    </div>
  )
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
  if (record["type"] !== "logos:story-comment" && record["type"] !== "logos:story-comment-reply") return null
  const clientEventId = record["clientEventId"]
  return typeof clientEventId === "string" && clientEventId.length > 0 ? clientEventId : null
}

function numberField(record: Record<string, unknown>, key: string): number | null {
  const value = record[key]
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function findMessageIframe(source: MessageEventSource | null): HTMLIFrameElement | null {
  if (source == null) return null
  for (const iframe of document.querySelectorAll<HTMLIFrameElement>("iframe.story-frame")) {
    if (iframe.contentWindow === source) return iframe
  }
  return null
}

export function runCommentPopupFromEvent(event: MessageEvent, frameOverride?: HTMLIFrameElement | null): CommentPopupState | null {
  const data = event.data
  if (typeof data !== "object" || data == null) return null
  const record = data as Record<string, unknown>
  if (record["type"] !== "logos:run-comment-target") return null
  const rect = typeof record["rect"] === "object" && record["rect"] != null ? record["rect"] as Record<string, unknown> : null
  const viewport = typeof record["viewport"] === "object" && record["viewport"] != null ? record["viewport"] as Record<string, unknown> : null
  if (!rect || !viewport) return null

  const left = numberField(rect, "left")
  const bottom = numberField(rect, "bottom")
  const viewportWidth = numberField(viewport, "width")
  const viewportHeight = numberField(viewport, "height")
  if (left == null || bottom == null || viewportWidth == null || viewportHeight == null) return null

  const iframe = frameOverride ?? findMessageIframe(event.source)
  const iframeRect = iframe?.getBoundingClientRect()
  const scaleX = iframeRect ? iframeRect.width / Math.max(1, viewportWidth) : 1
  const scaleY = iframeRect ? iframeRect.height / Math.max(1, viewportHeight) : 1
  const x = (iframeRect?.left ?? 0) + left * scaleX
  const y = (iframeRect?.top ?? 0) + bottom * scaleY + 8
  const storyId = stringField(record, "storyId")
  const component = stringField(record, "component")
  const appPath = stringField(record, "appPath")
  const target = component
    ? `component:${component}`
    : appPath
      ? `app:${appPath}`
      : storyId
        ? `story:${storyId}`
        : "app:/"

  return {
    target,
    label: stringField(record, "label") ?? component ?? appPath ?? storyId ?? "App",
    x,
    y,
    storyId,
    selector: stringField(record, "selector"),
    component,
    htmlContext: stringField(record, "htmlContext"),
    appPath,
    runTargetId: stringField(record, "runTargetId"),
    screenshotDataUrl: stringField(record, "screenshotDataUrl"),
    sourceWindow: event.source as Window | null,
  }
}

export function storyPopoverFromEvent(event: MessageEvent, frameOverride?: HTMLIFrameElement | null): CommentPopupState | null {
  const data = event.data
  if (typeof data !== "object" || data == null) return null
  const record = data as Record<string, unknown>
  if (record["type"] !== "logos:story-popover-show") return null
  const rect = typeof record["rect"] === "object" && record["rect"] != null ? record["rect"] as Record<string, unknown> : null
  const viewport = typeof record["viewport"] === "object" && record["viewport"] != null ? record["viewport"] as Record<string, unknown> : null
  if (!rect || !viewport) return null

  const rectRight = numberField(rect, "right")
  const rectTop = numberField(rect, "top")
  const viewportWidth = numberField(viewport, "width")
  const viewportHeight = numberField(viewport, "height")
  if (rectRight == null || rectTop == null || viewportWidth == null || viewportHeight == null) return null

  const iframe = frameOverride ?? findMessageIframe(event.source)
  const iframeRect = iframe?.getBoundingClientRect()
  const scaleX = iframeRect ? iframeRect.width / Math.max(1, viewportWidth) : 1
  const scaleY = iframeRect ? iframeRect.height / Math.max(1, viewportHeight) : 1
  const x = (iframeRect?.left ?? 0) + rectRight * scaleX + 12
  const y = (iframeRect?.top ?? 0) + rectTop * scaleY
  const component = stringField(record, "component")
  const storyId = stringField(record, "storyId")
  const selector = stringField(record, "selector")
  const htmlContext = stringField(record, "htmlContext")
  const screenshotDataUrl = stringField(record, "screenshotDataUrl")
  const label = stringField(record, "label") ?? component ?? storyId ?? "Comment"
  const target = component
    ? `component:${component}`
    : storyId
      ? `story:${storyId}`
      : "app:/"

  return {
    target,
    label,
    x: Math.min(x, window.innerWidth - 310),
    y: Math.min(Math.max(y, 8), window.innerHeight - 200),
    storyId,
    selector,
    component,
    htmlContext,
    screenshotDataUrl,
    sourceWindow: event.source as Window | null,
  }
}

function clearRunCommentAnnotation(sourceWindow?: Window | null): void {
  try {
    sourceWindow?.postMessage({ type: "logos:run-comment-clear" }, "*")
  } catch {}
}

function postRunCommentModifier(active: boolean, target?: Window | null): void {
  const message = { type: "logos:run-comment-modifier", active }
  if (target) {
    try { target.postMessage(message, "*") } catch {}
    return
  }
  document.querySelectorAll<HTMLIFrameElement>("iframe.story-frame").forEach((iframe) => {
    try { iframe.contentWindow?.postMessage(message, "*") } catch {}
  })
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
  const [popup, setPopup] = useState<CommentPopupState | null>(
    null
  )
  const [demoMenuOpen, setDemoMenuOpen] = useState(false)
  const [demos, setDemos] = useState<DemoOption[]>([])
  const [activeDemoId, setActiveDemoId] = useState<string>("")
  const [sourceProject, setSourceProject] = useState<string>("")
  const [demoSwitching, setDemoSwitching] = useState<string | null>(null)
  const topbarMenuRef = useRef<HTMLDivElement | null>(null)
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("main")

  // ---- workspaces (forks) ----
  const [railOpen, setRailOpen] = useState(true)
  const [railWidth, setRailWidth] = useState(280)
  const [commentWidth, setCommentWidth] = useState(320)
  const [sidebarWidth, setSidebarWidth] = useState(260)
  const [sidebarFiltersByScope, setSidebarFiltersByScope] = useState<Record<string, SidebarFilters>>(() => readStoredSidebarFilters())
  const [workspaces, setWorkspaces] = useState<WorkspaceMeta[]>([])
  const [workspacesLoading, setWorkspacesLoading] = useState(true)
  const [workspaceStartupPhase, setWorkspaceStartupPhase] = useState<WorkspaceStartupPhase>("boot")
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null)
  const activeWorkspaceIdRef = useRef<string | null>(null)
  const openWorkspaceSeqRef = useRef(0)
  const openWorkspaceAbortRef = useRef<AbortController | null>(null)
  const runCommentModifierActiveRef = useRef(false)
  const [openingWorkspaceId, setOpeningWorkspaceId] = useState<string | null>(null)
  const [pendingWorkspaceOpenId, setPendingWorkspaceOpenId] = useState<string | null>(null)
  const [workspaceViewState, setWorkspaceViewState] = useState<WorkspaceViewState | null>(null)
  const [selected, setSelected] = useState<{ type: "workspace" | "goal"; id: string } | null>(null)

  const activeWorkspaceView = selectActiveWorkspaceView(workspaceViewState, activeWorkspaceId)
  const workspaceIndex = activeWorkspaceView?.index ?? null
  const workspaceReviewIndex = activeWorkspaceView?.reviewIndex ?? null
  const workspaceBaselineIndex = activeWorkspaceView?.baselineIndex ?? null
  const view: StudioIndex = workspaceIndex ?? { root: "", files: [] }
  const selectedGoalId = selected?.type === "goal" ? selected.id : null
  const sidebarFilterScopeId = sidebarFilterScope(activeWorkspaceId, selectedGoalId)
  const sidebarFilters = useMemo(
    () => resolveSidebarFilters(sidebarFiltersByScope, sidebarFilterScopeId),
    [sidebarFiltersByScope, sidebarFilterScopeId],
  )
  const updateSidebarFilters = useCallback((update: (filters: SidebarFilters) => SidebarFilters) => {
    setSidebarFiltersByScope((current) => ({
      ...current,
      [sidebarFilterScopeId]: update(resolveSidebarFilters(current, sidebarFilterScopeId)),
    }))
  }, [sidebarFilterScopeId])
  const reviewBaseIndex = selectReviewBaseIndex(index, workspaceBaselineIndex)
  const reviewWorkspaceIndex = workspaceReviewIndex ?? workspaceIndex

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
  const activeWs = workspaces.find((w) => w.id === activeWorkspaceId)
  useEffect(() => {
    activeWorkspaceIdRef.current = activeWorkspaceId
  }, [activeWorkspaceId])
  const activeStorybookRoot = selectedStorybookRoot(view.files, selection)
  const { url: activeStorybookUrl, state: activeStorybookState } = selectActiveStorybookRuntime(
    activeWorkspaceId,
    activeWs,
    activeStorybookRoot,
    storybookUrls,
    storybookStates,
  )
  const activeStoryRenderer = selection.view === "story" ? "storybook" : "portable"
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

  useEffect(() => {
    if (selection.view === "run" || view.files.length === 0) return
    if (selection.file && !view.files.some((f) => f.file === selection.file)) {
      setSelection({ file: "", view: "run" })
    }
  }, [selection.view, selection.file, view.files])

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

  const stopRun = useCallback(async (targetId: string) => {
    if (!activeWorkspaceId) return
    try {
      await fetch(`/api/workspaces/${activeWorkspaceId}/runs/${encodeURIComponent(targetId)}`, {
        method: "DELETE",
      })
    } catch {}
    refreshRuns()
  }, [activeWorkspaceId, refreshRuns])

  const diff = useMemo(() => {
    if (!activeWorkspaceId || !reviewWorkspaceIndex) return {}
    return diffIndex(reviewBaseIndex, reviewWorkspaceIndex)
  }, [activeWorkspaceId, reviewWorkspaceIndex, reviewBaseIndex])

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
      const data = await res.json() as { active: string; sourceProject?: string; demos: DemoOption[] }
      setActiveDemoId(data.active)
      setSourceProject(data.sourceProject ?? "")
      setDemos(data.demos)
    } catch {}
  }, [])

  const loadWorkspaceReviewBase = useCallback(async (ws: Workspace, goalId?: string | null): Promise<StudioIndex> => {
    const goalBase = selectGoalReviewBaseIndex(ws, goalId)
    if (goalBase) return goalBase
    return selectWorkspaceReviewBaseIndex(index, ws)
  }, [index])

  const openWorkspace = useCallback(async (id: string, opts?: { resetView?: boolean; goalId?: string | null; loadingScope?: "project" | "workspace" }) => {
    openWorkspaceAbortRef.current?.abort()
    const controller = new AbortController()
    openWorkspaceAbortRef.current = controller
    openWorkspaceSeqRef.current += 1
    const requestSeq = openWorkspaceSeqRef.current
    const resetView = opts?.resetView !== false || activeWorkspaceIdRef.current !== id
    const activateImmediately = opts?.loadingScope !== "workspace"
    setOpeningWorkspaceId(id)
    if (activateImmediately) {
      setActiveWorkspaceId(id)
    }
    if (resetView && activateImmediately) {
      setWorkspaceViewState(null)
    }
    try {
      const res = await fetch(`/api/workspaces/${id}`, { cache: "no-store", signal: controller.signal })
      if (openWorkspaceSeqRef.current !== requestSeq) return
      if (res.ok) {
        const ws = (await res.json()) as Workspace
        if (openWorkspaceSeqRef.current !== requestSeq) return
        const meta = workspaceMetaFromWorkspace(ws)
        setWorkspaces((prev) => (
          prev.some((candidate) => candidate.id === meta.id)
            ? prev.map((candidate) => candidate.id === meta.id ? meta : candidate)
            : [meta, ...prev]
        ))
        if (workspaceReadyForDisplay(ws)) {
          const reviewIndex = selectWorkspaceReviewIndex(ws, opts?.goalId)
          const baselineIndex = await loadWorkspaceReviewBase(ws, opts?.goalId)
          if (openWorkspaceSeqRef.current !== requestSeq) return
          setPendingWorkspaceOpenId((current) => current === ws.id ? null : current)
          setActiveWorkspaceId(ws.id)
          setWorkspaceViewState({
            workspaceId: ws.id,
            index: ws.index,
            reviewIndex,
            baselineIndex,
          })
        } else if (!activateImmediately) {
          setPendingWorkspaceOpenId(ws.id)
        }
      }
    } catch (e) {
      if ((e as { name?: string }).name === "AbortError") return
    } finally {
      if (openWorkspaceSeqRef.current === requestSeq) {
        setOpeningWorkspaceId(null)
        if (openWorkspaceAbortRef.current === controller) openWorkspaceAbortRef.current = null
      }
    }
  }, [loadWorkspaceReviewBase])

  const reindexWorkspace = useCallback(async (id?: string | null, goalId?: string | null) => {
    const wsId = id ?? activeWorkspaceId
    if (!wsId) return
    try {
      const query = goalId ? `?goal=${encodeURIComponent(goalId)}` : ""
      const res = await fetch(`/api/workspaces/${wsId}/reindex${query}`, { method: "POST" })
      if (res.ok) {
        const ws = (await res.json()) as Workspace
        const reviewIndex = selectWorkspaceReviewIndex(ws, goalId)
        const baselineIndex = await loadWorkspaceReviewBase(ws, goalId)
        if (activeWorkspaceIdRef.current !== ws.id) return
        setWorkspaceViewState({
          workspaceId: ws.id,
          index: ws.index,
          reviewIndex,
          baselineIndex,
        })
        await refreshWorkspaces()
      }
    } catch {}
  }, [activeWorkspaceId, loadWorkspaceReviewBase, refreshWorkspaces])

  const createWorkspace = useCallback(
    async (
      fromWorkspaceId?: string | null,
      kind: WorkspaceKind = "code",
      name?: string,
      opts?: { loadingScope?: "project" | "workspace"; waitForOpen?: boolean; skipOpen?: boolean },
    ): Promise<string | null> => {
      try {
        const res = await fetch("/api/workspaces", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ fromWorkspaceId: fromWorkspaceId ?? undefined, kind, name }),
        })
        if (!res.ok) return null
        const meta = (await res.json()) as WorkspaceMeta
        if (opts?.skipOpen) {
          refreshWorkspaces().catch(() => {})
        } else if (opts?.waitForOpen === false) {
          refreshWorkspaces().catch(() => {})
          openWorkspace(meta.id, { loadingScope: opts.loadingScope ?? (activeWorkspaceIdRef.current ? "workspace" : "project") }).catch(() => {})
        } else {
          await refreshWorkspaces()
          const open = openWorkspace(meta.id, { loadingScope: opts?.loadingScope ?? (activeWorkspaceIdRef.current ? "workspace" : "project") })
          await open
        }
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
          await createWorkspace(null, "code", undefined, { loadingScope: "project" })
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
          if (latest != null) {
            await openWorkspace(latest.id, { loadingScope: "project" })
            const targetsRes = await fetch("/api/run-targets").catch(() => null)
            const targets = targetsRes?.ok ? ((await targetsRes.json()) as RunTarget[]) : []
            if (targets.length > 0) {
              fetch(`/api/workspaces/${latest.id}/runs/${encodeURIComponent(targets[0]!.id)}`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ restart: false }),
              }).catch(() => {})
            }
          }
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
          await createWorkspace(null, "code", undefined, { loadingScope: "project" })
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
    setBusy(`opening project: ${demo?.name ?? id}…`)
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
    if (!demoMenuOpen) return
    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && topbarMenuRef.current?.contains(target)) return
      setDemoMenuOpen(false)
    }
    document.addEventListener("pointerdown", closeOnOutsidePointerDown)
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointerDown)
  }, [demoMenuOpen])

  useEffect(() => {
    try {
      window.localStorage.setItem(SELECTION_STORAGE_KEY, JSON.stringify(selection))
    } catch {}
  }, [selection])

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_FILTERS_STORAGE_KEY, JSON.stringify(sidebarFiltersByScope))
    } catch {}
  }, [sidebarFiltersByScope])

  const [topView, setTopView] = useState<"project" | "review">("project")

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
            Promise.all([refreshWorkspaces(), refreshTests(), refreshStorybooks(), refreshRuns()]).then(() => {
              if (activeWorkspaceIdRef.current === wsId) openWorkspace(wsId, { resetView: false, goalId })
            })
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
          Promise.all([refreshWorkspaces(), refreshTests(), refreshStorybooks(), refreshRuns()]).then(() => {
            if (activeWorkspaceIdRef.current === wsId) openWorkspace(wsId, { resetView: false, goalId })
          })
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
        [goalId]: [...((prev[goalId]?.length ?? 0) > 0 ? prev[goalId]! : history), { type: "status", message: "accept started" }],
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
          Promise.all([refreshWorkspaces(), refreshTests(), refreshStorybooks(), refreshRuns()]).then(() => {
            if (activeWorkspaceIdRef.current === activeWorkspaceId) openWorkspace(activeWorkspaceId, { resetView: false, goalId })
          })
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
        Promise.all([refreshWorkspaces(), refreshTests(), refreshStorybooks(), refreshRuns()]).then(() => {
          if (activeWorkspaceIdRef.current === activeWorkspaceId) openWorkspace(activeWorkspaceId, { resetView: false, goalId })
        })
      }
    },
    [activeWorkspaceId, loadGoalSessionEvents, refreshWorkspaces, refreshTests, refreshStorybooks, refreshRuns, openWorkspace]
  )
  const closeAgent = useCallback(() => setAgentOpen(false), [])

  const resetWorkspaces = useCallback(async () => {
    if (!window.confirm("Delete all workspaces, changes, sessions, and generated forks, then start fresh?")) return
    setBusy("deleting workspaces…")
    setWorkspaceStartupPhase("reset")
    openWorkspaceAbortRef.current?.abort()
    openWorkspaceSeqRef.current += 1
    for (const es of esRefs.current.values()) es.close()
    esRefs.current.clear()
    setRunningGoals(new Set())
    setGoalEvents({})
    setAgentGoalId(null)
    setAgentOpen(false)
    setSelected(null)
    setWorkspaceViewState(null)
    setActiveWorkspaceId(null)
    setOpeningWorkspaceId(null)
    setWorkspaces([])
    setWorkspacesLoading(true)

    try {
      const resetRes = await fetch("/api/reset", { method: "POST" })
      if (!resetRes.ok) {
        await refreshWorkspaces()
        return
      }
      const data = await resetRes.json() as { workspace: WorkspaceMeta }
      setWorkspaces([data.workspace])
      setSelected({ type: "workspace", id: data.workspace.id })
      setActiveWorkspaceId(data.workspace.id)
      setWorkspacesLoading(false)
      setWorkspaceStartupPhase("boot")
      setBusy("initializing workspace…")
      await openWorkspace(data.workspace.id, { loadingScope: "project" })
      setSelection({ file: "", view: "run" })
      await Promise.all([refreshTests(), refreshStorybooks(), refreshRuns()])
    } finally {
      setWorkspaceStartupPhase("boot")
      setWorkspacesLoading(false)
      setBusy(null)
    }
  }, [openWorkspace, refreshWorkspaces, refreshTests, refreshStorybooks, refreshRuns])

  // Poll workspace index while agent is running
  useEffect(() => {
    if (!agentRunning || !activeWorkspaceId) return
    if (openingWorkspaceId === activeWorkspaceId) return
    const iv = setInterval(() => {
      if (selectedGoalId) reindexWorkspace(activeWorkspaceId, selectedGoalId)
      else openWorkspace(activeWorkspaceId, { resetView: false })
    }, 3_000)
    return () => clearInterval(iv)
  }, [agentRunning, activeWorkspaceId, openingWorkspaceId, selectedGoalId, reindexWorkspace, openWorkspace])

  const workspaceInitializing = workspaces.some((workspace) => workspace.initialization?.status === "initializing")
  useEffect(() => {
    if (!workspaceInitializing) return
    const iv = setInterval(() => {
      refreshWorkspaces()
    }, 1_000)
    return () => clearInterval(iv)
  }, [workspaceInitializing, refreshWorkspaces])

  useEffect(() => {
    if (!activeWorkspaceId || workspaceIndex || openingWorkspaceId === activeWorkspaceId) return
    if (!activeWs || !workspaceReadyForDisplay(activeWs)) return
    openWorkspace(activeWorkspaceId)
  }, [activeWorkspaceId, activeWs, openingWorkspaceId, openWorkspace, workspaceIndex])

  useEffect(() => {
    if (!pendingWorkspaceOpenId || openingWorkspaceId === pendingWorkspaceOpenId) return
    const pending = workspaces.find((workspace) => workspace.id === pendingWorkspaceOpenId)
    if (!pending || !workspaceReadyForDisplay(pending)) return
    setPendingWorkspaceOpenId(null)
    openWorkspace(pendingWorkspaceOpenId)
  }, [pendingWorkspaceOpenId, workspaces, openingWorkspaceId, openWorkspace])

  // ---- actions ----
  const onSelect = useCallback((sel: Selection) => {
    setSelection(sel)
    setMobilePanel("main")
  }, [])

  const openComment = useCallback(
    (target: string, label: string, x: number, y: number) => {
      setGoalError(null)
      setPopup({ target, label, x, y })
    },
    []
  )

  const addGoal = useCallback(
    async (
      target: string, label: string, text: string, fork: boolean,
      extra?: { storyId?: string; selector?: string; component?: string; htmlContext?: string; goalName?: string; workspaceName?: string; appPath?: string; runTargetId?: string; screenshotDataUrl?: string },
    ) => {
      const { workspaceName: explicitWorkspaceName, ...goalExtra } = extra ?? {}
      // 1. Forks are created client-side.
      const shouldFork = fork
      const workspaceName = explicitWorkspaceName ?? goalExtra.goalName ?? label
      let wsId = shouldFork
        ? await createWorkspace(activeWorkspaceId, "code", workspaceName, { skipOpen: true })
        : activeWorkspaceId
      if (!wsId) wsId = await createWorkspace(null, "code", workspaceName)
      if (!wsId) return

      // 2. Add change to workspace queue
      const goalRes = await fetch(`/api/workspaces/${wsId}/goals`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target, label, text, mode: "code", fork: shouldFork, ...goalExtra }),
      })
      const result = await goalRes.json()
      if (!goalRes.ok) {
        setGoalError(typeof result.error === "string" ? result.error : "failed to add change")
        return
      }
      setGoalError(null)
      const goal = result as Goal & { workspaceId?: string }
      const goalWsId = goal.workspaceId ?? wsId
      await refreshWorkspaces()
      setSelected({ type: "goal", id: goal.id })
      await openWorkspace(goalWsId, { goalId: goal.id })

      // 3. Trigger agent to process the queue
      runAgent(goalWsId, goal.id)
    },
    [activeWorkspaceId, createWorkspace, refreshWorkspaces, openWorkspace, runAgent]
  )

  const continueGoal = useCallback(
    (goalId: string, text: string) => {
      if (!activeWorkspaceId) return
      setSelected({ type: "goal", id: goalId })
      setRunningGoals((prev) => new Set(prev).add(goalId))
      setAgentGoalId(goalId)
      setAgentOpen(true)
      let closed = false
      loadGoalSessionEvents(goalId).then((history) => {
        if (history.length > 0) setGoalEvents((prev) => ({ ...prev, [goalId]: history }))
      })
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
                if (activeWorkspaceId) openWorkspace(activeWorkspaceId, { goalId })
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
                    if (activeWorkspaceId) openWorkspace(activeWorkspaceId, { goalId })
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
    [activeWorkspaceId, refreshWorkspaces, refreshTests, refreshStorybooks, openWorkspace, loadGoalSessionEvents],
  )

  const addStoryWritingGoal = useCallback(
    (target: string, label: string) => {
      addGoal(target, label, buildStoryWritingPrompt(label), true, {
        component: label,
        goalName: `Generate Stories for ${label}`,
        workspaceName: `Generate Stories for ${label}`,
      })
    },
    [addGoal]
  )

  const deleteItem = useCallback(async (path: string) => {
    try {
      const res = await fetch("/api/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path }),
      })
      if (res.ok) {
        if (activeWorkspaceId) {
          await reindexWorkspace()
        } else {
          const r = await fetch("/api/index?rebuild")
          if (r.ok) setIndex((await r.json()) as StudioIndex)
        }
      }
    } catch {}
  }, [activeWorkspaceId, reindexWorkspace])

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
        appPath: g.appPath,
        runTargetId: g.runTargetId,
        status: g.status,
        sessionId: g.sessionId,
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

  useEffect(() => {
    const setModifier = (active: boolean) => {
      if (runCommentModifierActiveRef.current === active) return
      runCommentModifierActiveRef.current = active
      postRunCommentModifier(active)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Alt") setModifier(true)
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Alt") setModifier(false)
    }
    const onBlur = () => setModifier(false)
    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("keyup", onKeyUp)
    window.addEventListener("blur", onBlur)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("keyup", onKeyUp)
      window.removeEventListener("blur", onBlur)
    }
  }, [])

  // Listen for story comments from Storybook iframe
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const runCommentPopup = runCommentPopupFromEvent(e)
      if (runCommentPopup) {
        setPopup((current) => {
          if (current?.sourceWindow && current.sourceWindow !== runCommentPopup.sourceWindow) {
            clearRunCommentAnnotation(current.sourceWindow)
          }
          return runCommentPopup
        })
        return
      }
      if (e.data?.type === "logos:story-ready") {
        postStoryGoals(e.source as Window | null)
        return
      }
      if (e.data?.type === "logos:story-popover-show") {
        const popup = storyPopoverFromEvent(e)
        if (popup) {
          setPopup(popup)
        }
        return
      }
      if (e.data?.type === "logos:story-popover-hide") {
        setPopup(null)
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
      if (e.data?.type === "logos:story-comment-reply") {
        if (!acceptStoryCommentEvent(e.data)) return
        const goalId = typeof e.data.goalId === "string" ? e.data.goalId : ""
        const text = typeof e.data.text === "string" ? e.data.text : ""
        if (goalId.length > 0 && text.trim().length > 0) continueGoal(goalId, text)
        return
      }
      if (e.data?.type !== "logos:story-comment") return
      if (!acceptStoryCommentEvent(e.data)) return
      const { storyId, component, selector, label, text, htmlContext, appPath, runTargetId, screenshotDataUrl } = e.data
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
      const target = component
        ? `component:${component}`
        : typeof appPath === "string" && appPath.length > 0
          ? `app:${appPath}`
          : `story:${storyId}`
      addGoal(target, label ?? storyId, text, true, {
        storyId,
        selector,
        component,
        htmlContext,
        appPath,
        runTargetId,
        screenshotDataUrl,
      })
    }
    window.addEventListener("message", onMsg)
    return () => window.removeEventListener("message", onMsg)
  }, [acceptStoryCommentEvent, addGoal, continueGoal, postStoryGoals])

  // Push goals to Storybook iframes so they can render pins
  useEffect(() => {
    postStoryGoals()
  }, [postStoryGoals])

  // Re-broadcast goals when story iframes load so pins appear immediately
  useEffect(() => {
    const onLoad = (e: Event) => {
      const iframe = e.target as HTMLIFrameElement
      if (iframe.classList?.contains("story-frame")) {
        postStoryGoals(iframe.contentWindow)
        postRunCommentModifier(runCommentModifierActiveRef.current, iframe.contentWindow)
      }
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

  const selectedGoal = selectedGoalId != null
    ? activeGoals.find((goal) => goal.id === selectedGoalId)
      ?? workspaces.flatMap((workspace) => workspace.goals).find((goal) => goal.id === selectedGoalId)
      ?? null
    : null
  const goalEventsRef = useRef(goalEvents)
  goalEventsRef.current = goalEvents
  const selectGoal = useCallback(async (workspaceId: string, id: string) => {
    setSelected({ type: "goal", id })
    const workspace = workspaces.find((candidate) => candidate.id === workspaceId)
    const goal = workspace?.goals.find((candidate) => candidate.id === id)
    await openWorkspace(workspaceId, { goalId: id })
    if (goal) navigateToGoal(goal)
    const existing = goalEventsRef.current[id]
    if (!existing || existing.length === 0) {
      const history = await loadGoalSessionEvents(id)
      if (history.length > 0) setGoalEvents((prev) => ({ ...prev, [id]: history }))
    }
  }, [workspaces, openWorkspace, navigateToGoal, loadGoalSessionEvents])

  const nComps = view.files.reduce((n, f) => n + (f.components?.length ?? (f.component ? 1 : 0)), 0)
  const totalChanges = workspaces.reduce((n, w) => n + (w.goals?.length ?? 0), 0)
  const activeProject = demos.find((d) => d.id === activeDemoId)
  const projectLabel = demoSwitching
    ? `Opening project: ${demos.find((d) => d.id === demoSwitching)?.name ?? demoSwitching}`
    : activeProject?.name ?? projectNameFromPath(sourceProject)
  const studioStyle = {
    "--rail-width": `${railWidth}px`,
    "--comment-width": `${commentWidth}px`,
    "--sidebar-width": `${sidebarWidth}px`,
  } as CSSProperties
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
  const startSidebarResize = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = sidebarWidth
    document.body.classList.add("resizing-sidebar")
    const onMove = (move: PointerEvent) => {
      const next = startWidth + move.clientX - startX
      setSidebarWidth(Math.min(520, Math.max(180, next)))
    }
    const onUp = () => {
      document.body.classList.remove("resizing-sidebar")
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }, [sidebarWidth])

  const renderViewToggle = () => (
    <nav className="view-toggle" aria-label="View switcher">
      <button
        type="button"
        className={`view-toggle-btn ${topView === "project" ? "active" : ""}`}
        onClick={() => setTopView("project")}
      >
        Project
      </button>
      <button
        type="button"
        className={`view-toggle-btn ${topView === "review" ? "active" : ""}`}
        onClick={() => setTopView("review")}
      >
        Review
      </button>
    </nav>
  )
  const activeWorkspaceCanDisplay = activeWs ? workspaceReadyForDisplay(activeWs) : workspaceIndex != null
  const workspaceUiReady = activeWorkspaceId != null && workspaceIndex != null && activeWorkspaceCanDisplay

  useEffect(() => {
    if (!workspaceUiReady) return
    setWorkspaceStartupPhase("idle")
  }, [workspaceUiReady])

  return (
    <div className={`studio ${railOpen ? "rail-open" : "rail-closed"} mobile-${mobilePanel}`} style={studioStyle}>
      <ChangesRail
        open={railOpen}
        onToggle={() => setRailOpen((o) => !o)}
        workspaces={workspaces}
        workspacesLoading={workspacesLoading}
        activeWorkspaceId={activeWorkspaceId}
        selected={selected}
        onOpenWorkspace={(id) => {
          setSelected({ type: "workspace", id })
          openWorkspace(id, { loadingScope: "workspace" })
        }}
        onCreatePullRequest={createWorkspacePullRequest}
        onSelectGoal={selectGoal}
        onDeleteWorkspace={deleteWorkspace}
        onDeleteGoal={deleteGoal}
        runningGoals={effectiveRunningGoals}
        onResizeStart={startRailResize}
        demos={demos}
        activeDemoId={activeDemoId}
        onOpenDemo={openDemo}
        demoMenuOpen={demoMenuOpen}
        onToggleDemoMenu={() => setDemoMenuOpen((o) => !o)}
        onResetWorkspaces={resetWorkspaces}
        topbarMenuRef={topbarMenuRef}
      />

      <CommentSidebar
        goal={selectedGoal}
        running={selectedGoal != null && effectiveRunningGoals.has(selectedGoal.id)}
        onNavigate={navigateToGoal}
        onReply={continueGoal}
        onMerge={mergeGoal}
        onNewComment={(text) => addGoal("project", "Claude", text, true)}
        onClose={() => setSelected(null)}
        onResizeStart={startCommentResize}
      />

      <aside className="sidebar">
        <div className="sidebar-resize" onPointerDown={startSidebarResize} />
        <div className="sidebar-toolbar">
          <button
            className={`sidebar-filter fn ${sidebarFilters.functions ? "active" : ""}`}
            type="button"
            aria-pressed={sidebarFilters.functions}
            aria-label={sidebarFilters.functions ? "Hide functions" : "Show functions"}
            title={sidebarFilters.functions ? "Hide functions" : "Show functions"}
            onClick={() => updateSidebarFilters((filters) => ({ ...filters, functions: !filters.functions }))}
          >
            {ICONS.fn}
          </button>
          <button
            className={`sidebar-filter cls ${sidebarFilters.classes ? "active" : ""}`}
            type="button"
            aria-pressed={sidebarFilters.classes}
            aria-label={sidebarFilters.classes ? "Hide classes" : "Show classes"}
            title={sidebarFilters.classes ? "Hide classes" : "Show classes"}
            onClick={() => updateSidebarFilters((filters) => ({ ...filters, classes: !filters.classes }))}
          >
            {ICONS.cls}
          </button>
          <button
            className={`sidebar-filter comp ${sidebarFilters.components ? "active" : ""}`}
            type="button"
            aria-pressed={sidebarFilters.components}
            aria-label={sidebarFilters.components ? "Hide React components" : "Show React components"}
            title={sidebarFilters.components ? "Hide React components" : "Show React components"}
            onClick={() => updateSidebarFilters((filters) => ({ ...filters, components: !filters.components }))}
          >
            {ICONS.comp}
          </button>
          <button
            className={`sidebar-filter type ${sidebarFilters.types ? "active" : ""}`}
            type="button"
            aria-pressed={sidebarFilters.types}
            aria-label={sidebarFilters.types ? "Hide types" : "Show types"}
            title={sidebarFilters.types ? "Hide types" : "Show types"}
            onClick={() => updateSidebarFilters((filters) => ({ ...filters, types: !filters.types }))}
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
          onDelete={deleteItem}
          diff={diff}
          testState={testState}
          runTargets={runTargets}
          runStates={activeRunStatesByTarget}
          onRun={startRun}
          onStop={stopRun}
          showFunctions={sidebarFilters.functions}
          showClasses={sidebarFilters.classes}
          showComponents={sidebarFilters.components}
          showTypes={sidebarFilters.types}
        />
      </aside>

      <GotoCtx.Provider value={gotoCtx}>
      <main className="main">
        <div className="main-header">
          {renderViewToggle()}
        </div>
        <div className="main-view">
          {!workspaceUiReady ? (
            <div className="empty">
              {workspacesLoading ? "Workspaces still loading" : "Select a workspace"}
            </div>
          ) : topView === "review" ? (
            <ReviewPanel
              base={reviewBaseIndex}
              workspace={(reviewWorkspaceIndex ?? workspaceIndex)!}
              showHeaderTitle={false}
              screenshots={activeWorkspaceId && activeWs ? {
                workspaceId: activeWorkspaceId,
                baseInstanceId: activeWs.baseInstanceId,
                workspaceInstanceId: activeWs.activeInstanceId,
              } : undefined}
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
        {topView === "project" && agentOpen && (
          <AgentPanel events={agentPanelEvents} running={agentPanelRunning} goal={agentPanelGoal} onClose={closeAgent} />
        )}
      </main>
      </GotoCtx.Provider>

      <footer className="statusbar">
        <span>
          {svgIcon("M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9", 11)}{" "}
          {activeWs?.name ?? "workspace"}{" "}
          <a className="refresh-btn" onClick={() => reindexWorkspace(undefined, selectedGoalId)} title="Re-index workspace from disk">↻</a>
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
          {goalError ? <span className="status-error">change error: {goalError}</span> :
            publishError ? <span className="status-error">{publishError}</span> :
            busy ? busy :
            `${view.files.length} files · ${nComps} components · ${totalChanges} changes · ${workspaces.length} workspaces`}
        </span>
      </footer>

      {popup && (
        <CommentPopup
          x={popup.x}
          y={popup.y}
          label={popup.label}
          goals={goalsByTarget[popup.target] ?? []}
          onAdd={(text) => {
            const extra = popup.storyId ? {
              storyId: popup.storyId,
              ...(popup.selector ? { selector: popup.selector } : {}),
              ...(popup.component ? { component: popup.component } : {}),
              ...(popup.htmlContext ? { htmlContext: popup.htmlContext } : {}),
              ...(popup.appPath ? { appPath: popup.appPath } : {}),
              ...(popup.runTargetId ? { runTargetId: popup.runTargetId } : {}),
              ...(popup.screenshotDataUrl ? { screenshotDataUrl: popup.screenshotDataUrl } : {}),
            } : undefined
            addGoal(popup.target, popup.label, text, true, extra)
            clearRunCommentAnnotation(popup.sourceWindow)
            setPopup(null)
          }}
          onReply={(goalId, text) => { continueGoal(goalId, text) }}
          onClose={() => {
            clearRunCommentAnnotation(popup.sourceWindow)
            try { popup.sourceWindow?.postMessage({ type: "logos:story-popover-closed" }, "*") } catch {}
            setPopup(null)
          }}
        />
      )}
    </div>
  )
}
