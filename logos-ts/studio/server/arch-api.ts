import { fallbackGoalName } from "../../src/goal-naming"
import type { Connect } from "vite"
import type { IncomingMessage, ServerResponse } from "node:http"
import type {
  ArchContentResponse,
  ArchDiagnostic,
  ArchEvaluationResponse,
  ArchNodeKind,
  ArchNodeStatus,
  ArchPreview,
  ArchReviewResponse,
  ArchSnapshotChange,
  ArchTreeNode,
  ArchTreeResponse,
  ArchWorkspaceResponse,
  ArchWorkspaceSummary,
} from "../src/arch-api"
import type {
  ComponentEntry,
  DiffStatus,
  FileEntry,
  FileItem,
  Goal,
  RunState,
  RunTarget,
  SbState,
  StudioIndex,
  TestRef,
  TestState,
  Workspace,
  WorkspaceMeta,
} from "../src/types"
import { diffIndex } from "../src/diff"
import { indexToArchText, lineDiff } from "../src/arch-text"
import { extractSnapshotHtml, snapshotChanges } from "../src/review"
import { publicRunUrl } from "./run-proxy"
import type { SbEntry } from "../../src/storybook-manager"

type WorkspaceManagerLike = {
  list(): WorkspaceMeta[]
  get(id: string): Workspace | undefined
  create(opts?: { name?: string; fromWorkspaceId?: string; kind?: "code" }): Promise<WorkspaceMeta>
  addGoal(
    workspaceId: string,
    goal: Omit<Goal, "status" | "lifecycle" | "mergePolicy" | "workingInstanceId" | "mergedInstanceId">,
    opts?: { fork?: boolean },
  ): Promise<{ goal: Goal; workspaceId: string } | { error: string; status: number }>
  renameGoal(workspaceId: string, goalId: string, label: string): Goal | null
  ensureStorybook(workspaceId: string): Promise<void>
  ensureRun(workspaceId: string, targetId: string, opts?: { restart?: boolean }): Promise<void>
}

type StorybookManagerLike = {
  all(): Record<string, SbEntry>
  allStates(): Record<string, SbState>
}

type RunManagerLike = {
  get(workspaceId: string, targetId: string): string | null
  allStates(): Record<string, RunState>
}

interface ArchApiRuntime {
  projectIndex: () => Promise<StudioIndex>
  wsMgr: WorkspaceManagerLike
  sbManager: StorybookManagerLike
  runManager: RunManagerLike
  runTargets: RunTarget[]
  testState: TestState
  readBody: (req: Connect.IncomingMessage) => Promise<string>
  generateGoalName: (input: {
    text: string
    label: string
    target: string
    mode: "code"
    component: string | null
    storyId: string | null
    selector: string | null
    htmlContext: string | null
  }) => Promise<string>
}

interface ArchContext {
  workspace: Workspace
  index: StudioIndex
  baseIndex: StudioIndex
  diff: Record<string, DiffStatus>
}

const rootNodeId = "arch:root"

function json(res: ServerResponse, body: unknown, status = 200): void {
  res.statusCode = status
  res.setHeader("content-type", "application/json")
  res.setHeader("cache-control", "no-store")
  res.end(JSON.stringify(body))
}

function componentsOf(file: FileEntry): ComponentEntry[] {
  return file.components?.length ? file.components : file.component ? [file.component] : []
}

function testCount(item: FileItem): number {
  if (item.kind === "type") return 0
  if (item.kind === "class") {
    return item.tests.length + item.methods.reduce((sum, method) => sum + method.tests.length, 0)
  }
  return item.tests.length
}

function targetComments(goals: Goal[], target: string): number {
  return goals.filter((goal) => goal.target === target).length
}

function statusFor(diff: Record<string, DiffStatus>, target: string): ArchNodeStatus | null {
  return diff[target] ?? null
}

function stringField(body: Record<string, unknown>, key: string, fallback: string): string {
  const value = body[key]
  return typeof value === "string" ? value : fallback
}

function storybookServiceId(workspace: Workspace, storybookRoot: string | undefined): string {
  const instanceId = workspace.activeInstanceId
  return storybookRoot && storybookRoot !== "." ? `${instanceId}:${storybookRoot}` : instanceId
}

function previewIdForStory(workspace: Workspace, storybookRoot: string | undefined): string {
  return `storybook:${storybookServiceId(workspace, storybookRoot)}`
}

function createNode(
  nodes: ArchTreeNode[],
  node: Omit<ArchTreeNode, "comments" | "tests" | "stories" | "selectable"> & Partial<Pick<ArchTreeNode, "comments" | "tests" | "stories" | "selectable">>,
): ArchTreeNode {
  const next: ArchTreeNode = {
    comments: 0,
    tests: 0,
    stories: 0,
    selectable: true,
    ...node,
  }
  nodes.push(next)
  return next
}

function rollup(nodes: ArchTreeNode[], id: string): void {
  const node = nodes.find((candidate) => candidate.id === id)
  if (!node) return
  const children = nodes.filter((candidate) => candidate.parentId === id)
  node.comments += children.reduce((sum, child) => sum + child.comments, 0)
  node.tests += children.reduce((sum, child) => sum + child.tests, 0)
  node.stories += children.reduce((sum, child) => sum + child.stories, 0)
  if (!node.status) {
    const childStatus = children.find((child) => child.status)?.status
    if (childStatus) node.status = childStatus
  }
}

export function buildArchTree(
  workspace: Workspace,
  index: StudioIndex,
  diff: Record<string, DiffStatus>,
): ArchTreeResponse {
  const nodes: ArchTreeNode[] = []
  const goals = workspace.goals
  createNode(nodes, {
    id: rootNodeId,
    parentId: null,
    kind: "app",
    label: workspace.name,
    path: "app",
    selectable: false,
  })

  const groupIds = new Map<string, string>()
  const ensureGroup = (path: string, label: string, parentId = rootNodeId): string => {
    const existing = groupIds.get(path)
    if (existing) return existing
    const id = `group:${path}`
    groupIds.set(path, id)
    createNode(nodes, {
      id,
      parentId,
      kind: "group",
      label,
      path,
      selectable: false,
    })
    return id
  }

  for (const file of index.files) {
    const parts = file.file.split("/")
    let parentId = rootNodeId
    let path = ""
    for (let i = 0; i < parts.length - 1; i += 1) {
      path = path ? `${path}/${parts[i]}` : parts[i]!
      parentId = ensureGroup(path, parts[i]!, parentId)
    }

    const moduleLabel = (parts[parts.length - 1] ?? file.file).replace(/\.(tsx?|jsx?)$/, "")
    const moduleId = `module:${file.file}`
    const components = componentsOf(file)
    const moduleStatus = statusFor(diff, `file:${file.file}`)
    createNode(nodes, {
      id: moduleId,
      parentId,
      kind: "module",
      label: moduleLabel,
      path: file.file,
      target: `file:${file.file}`,
      comments: targetComments(goals, `file:${file.file}`),
      selectable: true,
      ...(moduleStatus == null ? {} : { status: moduleStatus }),
    })

    for (const component of components) {
      const componentTarget = `component:${component.name}`
      const componentId = `component:${component.name}`
      let componentStatus = statusFor(diff, componentTarget)
      if (componentStatus == null && component.propsName != null) {
        componentStatus = statusFor(diff, `props:${component.propsName}`)
      }
      createNode(nodes, {
        id: componentId,
        parentId: moduleId,
        kind: "component",
        label: component.name,
        path: `${file.file}#${component.name}`,
        target: componentTarget,
        comments: targetComments(goals, componentTarget),
        tests: 0,
        stories: component.stories.length,
        ...(componentStatus ? { status: componentStatus } : {}),
      })
      for (const story of component.stories) {
        const storyId = `story:${story.id}`
        const storyCommentCount = goals.filter((goal) => goal.storyId === story.id).length
        createNode(nodes, {
          id: storyId,
          parentId: componentId,
          kind: "story",
          label: story.exportName,
          path: `${file.file}#${component.name}/stories/${story.exportName}`,
          target: componentTarget,
          comments: storyCommentCount,
          stories: 1,
        })
      }
    }

    for (const item of file.items) {
      const kind: ArchNodeKind = item.kind === "type" ? "type" : item.kind === "class" ? "service" : "service"
      const target = item.kind === "type" ? `type:${item.name}` : item.kind === "class" ? `cls:${item.name}` : `fn:${item.name}`
      const itemId = `${kind}:${file.file}:${item.name}`
      const itemStatus = statusFor(diff, target)
      createNode(nodes, {
        id: itemId,
        parentId: moduleId,
        kind,
        label: item.name,
        path: `${file.file}#${item.name}`,
        target,
        comments: targetComments(goals, target),
        tests: testCount(item),
        ...(itemStatus == null ? {} : { status: itemStatus }),
      })
      if (item.kind === "function") {
        for (const test of item.tests) {
          createNode(nodes, testNode(test, itemId))
        }
      } else if (item.kind === "class") {
        for (const test of item.tests) createNode(nodes, testNode(test, itemId))
        for (const method of item.methods) {
          for (const test of method.tests) createNode(nodes, testNode(test, itemId))
        }
      }
    }
  }

  for (let i = nodes.length - 1; i >= 0; i -= 1) rollup(nodes, nodes[i]!.id)
  return {
    workspaceId: workspace.id,
    snapshotId: workspace.activeInstanceId,
    rootNodeId,
    nodes,
  }
}

function testNode(test: TestRef, parentId: string): Omit<ArchTreeNode, "comments" | "tests" | "stories" | "selectable"> & Partial<Pick<ArchTreeNode, "comments" | "tests" | "stories" | "selectable">> {
  return {
    id: `test:${test.file}::${test.name}`,
    parentId,
    kind: "test",
    label: test.name,
    path: `${test.file}#${test.name}`,
    target: `test:${test.file}::${test.name}`,
    tests: 1,
  }
}

function archWorkspace(meta: WorkspaceMeta): ArchWorkspaceSummary {
  return {
    id: meta.id,
    name: meta.name,
    kind: meta.kind,
    parentId: meta.parentId,
    createdAt: meta.createdAt,
    activeSnapshotId: meta.activeInstanceId,
    goals: meta.goals,
    ...(meta.initialization ? { initialization: meta.initialization } : {}),
    ...(meta.publication ? { publication: meta.publication } : {}),
  }
}

function previewNodes(tree: ArchTreeResponse, kind: "story" | "run"): string[] {
  return tree.nodes.filter((node) => node.kind === kind).map((node) => node.id)
}

function buildEvaluation(
  workspace: Workspace,
  tree: ArchTreeResponse,
  runtime: Pick<ArchApiRuntime, "sbManager" | "runManager" | "runTargets" | "testState">,
): ArchEvaluationResponse {
  const previews: ArchPreview[] = []
  const storybookStates = runtime.sbManager.allStates()
  const storybookEntries = runtime.sbManager.all()
  const storybookNodeIds = previewNodes(tree, "story")
  const storybookIds = new Set<string>()
  for (const file of workspace.index.files) {
    for (const component of componentsOf(file)) {
      for (const story of component.stories) storybookIds.add(storybookServiceId(workspace, story.storybookRoot))
    }
  }
  if (storybookIds.size === 0) storybookIds.add(workspace.activeInstanceId)
  for (const serviceId of storybookIds) {
    const state = storybookStates[serviceId]
    previews.push({
      id: `storybook:${serviceId}`,
      kind: "storybook",
      label: "Storybook",
      status: state?.status ?? (storybookEntries[serviceId] ? "ready" : "starting"),
      url: storybookEntries[serviceId]?.url ?? null,
      nodeIds: storybookNodeIds,
      ...(state?.error ? { error: state.error } : {}),
    })
  }

  const runStates = runtime.runManager.allStates()
  for (const target of runtime.runTargets) {
    const key = `${workspace.id}:${target.id}`
    const state = runStates[key]
    const isRunning = runtime.runManager.get(workspace.id, target.id) != null
    previews.push({
      id: `app:${target.id}`,
      kind: "app",
      label: target.label,
      status: state?.status ?? (isRunning ? "ready" : "starting"),
      url: isRunning ? publicRunUrl(workspace.id, target.id) : null,
      nodeIds: [],
      ...(state?.error ? { error: state.error } : {}),
    })
  }

  const checks: ArchDiagnostic[] = []
  const testSeverity = runtime.testState.status === "fail" ? "error" : "info"
  checks.push({
    id: "tests",
    kind: "test",
    status: runtime.testState.status,
    severity: testSeverity,
    title: "Tests",
    nodeIds: [],
    ...(runtime.testState.results ? { message: `${runtime.testState.results.passed}/${runtime.testState.results.total} passing` } : {}),
    ...(runtime.testState.runningSince ? { startedAt: runtime.testState.runningSince } : {}),
  })
  for (const preview of previews) {
    checks.push({
      id: preview.id,
      kind: preview.kind,
      status: preview.status === "ready" ? "pass" : preview.status === "failed" ? "fail" : "running",
      severity: preview.status === "failed" ? "error" : "info",
      title: preview.label,
      nodeIds: preview.nodeIds,
      ...(preview.error ? { message: preview.error } : {}),
    })
  }

  const failed = checks.some((check) => check.status === "fail")
  const running = checks.some((check) => check.status === "running" || check.status === "pending")
  return {
    workspaceId: workspace.id,
    snapshotId: workspace.activeInstanceId,
    status: failed ? "fail" : running ? "running" : checks.length ? "pass" : "idle",
    checks,
    previews,
  }
}

function buildContent(ctx: ArchContext, tree: ArchTreeResponse, evaluation: ArchEvaluationResponse, nodeId: string): ArchContentResponse | null {
  const node = tree.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) return null

  const sections: ArchContentResponse["sections"] = []
  sections.push({
    kind: "summary",
    title: "Summary",
    body: `${node.kind} · ${node.path}`,
  })

  if (node.kind === "component") {
    const component = findComponent(ctx.index, node.label)
    if (component) {
      sections.push({
        kind: "contract",
        title: "Contract",
        fields: [
          { name: "signature", value: component.signature },
          ...component.propsFields.map((field) => ({ name: field.name, value: field.type })),
        ],
      })
      sections.push({
        kind: "stories",
        title: "Stories",
        stories: component.stories.map((story) => ({
          id: story.id,
          label: story.exportName,
          previewId: previewIdForStory(ctx.workspace, story.storybookRoot),
        })),
      })
    }
  } else if (node.kind === "service" || node.kind === "type") {
    const item = findItem(ctx.index, node.path)
    if (item) {
      const fields = item.kind === "class"
        ? [
            ...item.fields.map((field) => ({ name: field.name, value: field.type })),
            ...item.methods.map((method) => ({ name: method.name, value: method.signature })),
          ]
        : [{ name: "signature", value: item.signature }]
      sections.push({ kind: "contract", title: "Contract", fields })
    }
  }

  const diagnostics = evaluation.checks.filter((check) => check.nodeIds.includes(node.id))
  if (diagnostics.length > 0) {
    sections.push({ kind: "diagnostics", title: "Diagnostics", diagnostics })
  }

  return {
    workspaceId: ctx.workspace.id,
    snapshotId: ctx.workspace.activeInstanceId,
    nodeId,
    title: node.label,
    kind: node.kind,
    sections,
    ...(evaluation.previews.find((preview) => preview.nodeIds.includes(node.id))?.id
      ? { primaryPreviewId: evaluation.previews.find((preview) => preview.nodeIds.includes(node.id))!.id }
      : {}),
  }
}

function findComponent(index: StudioIndex, name: string): ComponentEntry | null {
  for (const file of index.files) {
    const component = componentsOf(file).find((candidate) => candidate.name === name)
    if (component) return component
  }
  return null
}

function findItem(index: StudioIndex, path: string): FileItem | null {
  const [filePath, name] = path.split("#")
  if (!filePath || !name) return null
  return index.files.find((file) => file.file === filePath)?.items.find((item) => item.name === name) ?? null
}

function buildReview(workspace: Workspace, baseIndex: StudioIndex, index: StudioIndex): ArchReviewResponse {
  const lines = lineDiff(indexToArchText(baseIndex), indexToArchText(index))
  const architectureChanges = lines
    .filter((line) => line.type !== "same" && line.text.trim())
    .map((line, index) => ({
      id: `arch-change:${index}`,
      status: line.type === "add" ? "added" as const : "removed" as const,
      title: line.text,
      nodeIds: [],
      ...(line.type === "add" ? { after: line.text } : { before: line.text }),
    }))

  const snapshots: ArchSnapshotChange[] = snapshotChanges(baseIndex, index).map((change) => ({
    id: change.id,
    component: change.component,
    story: change.exportName,
    status: change.status,
    ...(extractSnapshotHtml(change.beforeSnapshot) ? { beforeHtml: extractSnapshotHtml(change.beforeSnapshot)! } : {}),
    ...(extractSnapshotHtml(change.afterSnapshot) ? { afterHtml: extractSnapshotHtml(change.afterSnapshot)! } : {}),
  }))

  return {
    workspaceId: workspace.id,
    baseSnapshotId: workspace.baseInstanceId,
    snapshotId: workspace.activeInstanceId,
    architectureChanges,
    snapshotChanges: snapshots,
  }
}

async function archContext(runtime: ArchApiRuntime, workspaceId: string): Promise<ArchContext | null> {
  const workspace = runtime.wsMgr.get(workspaceId)
  if (!workspace) return null
  const projectIndex = await runtime.projectIndex()
  const baseIndex = workspace.instances[workspace.baseInstanceId]?.index
  const index = workspace.index
  return {
    workspace,
    index,
    baseIndex: baseIndex ?? projectIndex,
    diff: diffIndex(baseIndex ?? projectIndex, index),
  }
}

function fullWorkspaceResponse(ctx: ArchContext, runtime: ArchApiRuntime): ArchWorkspaceResponse {
  const tree = buildArchTree(ctx.workspace, ctx.index, ctx.diff)
  const evaluation = buildEvaluation(ctx.workspace, tree, runtime)
  return {
    workspace: archWorkspace(ctx.workspace),
    tree,
    evaluation,
    review: buildReview(ctx.workspace, ctx.baseIndex, ctx.index),
  }
}

export function createArchApi(runtime: ArchApiRuntime): Connect.NextHandleFunction {
  return (req: IncomingMessage, res: ServerResponse) => {
    void handleArchApi(runtime, req, res)
  }
}

async function handleArchApi(runtime: ArchApiRuntime, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || "/", "http://logos.local")
    const sub = url.pathname.replace(/^\/+/, "")
    const parts = sub.split("/").filter(Boolean)

    try {
      if (req.method === "GET" && parts.length === 1 && parts[0] === "workspaces") {
        json(res, { workspaces: runtime.wsMgr.list().map(archWorkspace) })
        return
      }

      if (req.method === "POST" && parts.length === 1 && parts[0] === "workspaces") {
        const body = JSON.parse((await runtime.readBody(req)) || "{}") as { name?: string; fromWorkspaceId?: string }
        const workspace = await runtime.wsMgr.create({
          kind: "code",
          ...(typeof body.name === "string" ? { name: body.name } : {}),
          ...(typeof body.fromWorkspaceId === "string" ? { fromWorkspaceId: body.fromWorkspaceId } : {}),
        })
        json(res, { workspace: archWorkspace(workspace) })
        return
      }

      if (parts[0] !== "workspaces" || !parts[1]) {
        json(res, { error: "not found" }, 404)
        return
      }

      const workspaceId = decodeURIComponent(parts[1])
      const ctx = await archContext(runtime, workspaceId)
      if (!ctx) {
        json(res, { error: "workspace not found" }, 404)
        return
      }

      if (req.method === "GET" && parts.length === 2) {
        json(res, fullWorkspaceResponse(ctx, runtime))
        return
      }

      if (req.method === "GET" && parts[2] === "tree") {
        json(res, buildArchTree(ctx.workspace, ctx.index, ctx.diff))
        return
      }

      if (req.method === "GET" && parts[2] === "evaluation") {
        const tree = buildArchTree(ctx.workspace, ctx.index, ctx.diff)
        json(res, buildEvaluation(ctx.workspace, tree, runtime))
        return
      }

      if (req.method === "GET" && parts[2] === "review") {
        json(res, buildReview(ctx.workspace, ctx.baseIndex, ctx.index))
        return
      }

      if (req.method === "GET" && parts[2] === "content") {
        const nodeId = url.searchParams.get("nodeId") ?? rootNodeId
        const tree = buildArchTree(ctx.workspace, ctx.index, ctx.diff)
        const content = buildContent(ctx, tree, buildEvaluation(ctx.workspace, tree, runtime), nodeId)
        if (!content) {
          json(res, { error: "node not found" }, 404)
          return
        }
        json(res, content)
        return
      }

      if (req.method === "POST" && parts[2] === "goals") {
        const body = JSON.parse((await runtime.readBody(req)) || "{}") as Record<string, unknown>
        const targetNodeId = typeof body["targetNodeId"] === "string" ? body["targetNodeId"] : rootNodeId
        const tree = buildArchTree(ctx.workspace, ctx.index, ctx.diff)
        const node = tree.nodes.find((candidate) => candidate.id === targetNodeId)
        const target = typeof body["target"] === "string" ? body["target"] : node?.target ?? targetNodeId
        const labelInput = stringField(body, "label", node?.label ?? "Arch change")
        const text = stringField(body, "text", "")
        const namingInput = {
          text,
          label: labelInput,
          target,
          mode: "code" as const,
          component: node?.kind === "component" ? node.label : null,
          storyId: typeof body["storyId"] === "string" ? body["storyId"] : node?.kind === "story" ? node.id.replace(/^story:/, "") : null,
          selector: typeof body["selector"] === "string" ? body["selector"] : null,
          htmlContext: typeof body["htmlContext"] === "string" ? body["htmlContext"] : null,
        }
        const goalId = `goal-${Date.now()}-${Math.round(Math.random() * 1e6)}`
        const result = await runtime.wsMgr.addGoal(workspaceId, {
          id: goalId,
          text,
          label: fallbackGoalName(namingInput),
          target,
          mode: "code",
          createdAt: Date.now(),
          storyId: namingInput.storyId,
          selector: namingInput.selector,
          component: namingInput.component,
          screenshotDataUrl: typeof body["screenshotDataUrl"] === "string" ? body["screenshotDataUrl"] : null,
        }, { fork: body["fork"] === true })
        if ("error" in result) {
          json(res, { error: result.error }, result.status)
          return
        }
        json(res, { goalId: result.goal.id, workspaceId: result.workspaceId, status: "queued", goal: result.goal })
        runtime.generateGoalName(namingInput).then((name) => {
          runtime.wsMgr.renameGoal(result.workspaceId, goalId, name)
        }).catch(() => {})
        return
      }

      if (req.method === "POST" && parts[2] === "previews" && parts[3]) {
        const previewId = decodeURIComponent(parts[3])
        if (previewId.startsWith("storybook:")) {
          runtime.wsMgr.ensureStorybook(workspaceId).catch((error: unknown) => {
            console.error(`[logos] arch storybook for ${workspaceId} failed to start:`, error instanceof Error ? error.message : String(error))
          })
          json(res, { ok: true })
          return
        }
        if (previewId.startsWith("app:")) {
          const targetId = previewId.replace(/^app:/, "")
          const body = JSON.parse((await runtime.readBody(req)) || "{}") as { restart?: boolean }
          runtime.wsMgr.ensureRun(workspaceId, targetId, { restart: body.restart === true }).catch((error: unknown) => {
            console.error(`[logos] arch app ${targetId} for ${workspaceId} failed to start:`, error instanceof Error ? error.message : String(error))
          })
          json(res, { ok: true })
          return
        }
      }

      if (req.method === "GET" && parts[2] === "events") {
        res.setHeader("content-type", "text/event-stream")
        res.setHeader("cache-control", "no-cache")
        res.setHeader("connection", "keep-alive")
        const send = (payload: unknown) => res.write(`data: ${JSON.stringify(payload)}\n\n`)
        send({ type: "workspace", ...fullWorkspaceResponse(ctx, runtime) })
        const interval = setInterval(() => {
          void archContext(runtime, workspaceId).then((next) => {
            if (next) send({ type: "evaluation", ...buildEvaluation(next.workspace, buildArchTree(next.workspace, next.index, next.diff), runtime) })
          })
        }, 2_000)
        req.on("close", () => clearInterval(interval))
        return
      }

      json(res, { error: "not found" }, 404)
    } catch (error) {
      json(res, { error: error instanceof Error ? error.message : String(error) }, 500)
    }
}
