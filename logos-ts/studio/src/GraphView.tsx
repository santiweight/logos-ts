import { useState, useEffect, useCallback, useMemo } from "react"
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  BackgroundVariant,
  type NodeTypes,
  Panel,
  useReactFlow,
  ReactFlowProvider,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import ELK, { type ElkNode, type ElkExtendedEdge } from "elkjs/lib/elk.bundled.js"
import { FileGroupNode, type FileGroupData, type SymbolInfo } from "./FileGroupNode"
import { DirGroupNode, type DirGroupData } from "./DirGroupNode"
import type { GraphData } from "./graph-types"

const nodeTypes: NodeTypes = {
  fileGroup: FileGroupNode as any,
  dirGroup: DirGroupNode as any,
}

const elk = new ELK()

const ELK_OPTS: Record<string, string> = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.layered.spacing.nodeNodeBetweenLayers": "80",
  "elk.spacing.nodeNode": "24",
  "elk.layered.spacing.edgeNodeBetweenLayers": "30",
  "elk.padding": "[top=48,left=20,bottom=20,right=20]",
  "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
  "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.hierarchyHandling": "SEPARATE_CHILDREN",
  "elk.layered.mergeEdges": "false",
  "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
}

const FILE_W = 240
const FILE_H_COLLAPSED = 44
const SYM_H = 26
const DIR_COLLAPSED_W = 220
const DIR_COLLAPSED_H = 44

interface FileInfo {
  filePath: string
  label: string
  symbols: SymbolInfo[]
}

function fileHeight(file: FileInfo, fileId: string, expandedFiles: Set<string>, expandedClasses: Set<string>): number {
  if (!expandedFiles.has(fileId)) return FILE_H_COLLAPSED
  const topLevel = file.symbols.filter((s) => s.kind !== "method")
  let h = 38 + topLevel.length * SYM_H + 12
  for (const sym of topLevel) {
    if (sym.kind === "class" && expandedClasses.has(sym.id)) {
      h += file.symbols.filter((s) => s.parent === sym.id).length * SYM_H
    }
  }
  return h
}

interface DirTree {
  files: Map<string, FileInfo>
  children: Map<string, DirTree>
}

function buildDirTree(files: Map<string, FileInfo>): DirTree {
  const root: DirTree = { files: new Map(), children: new Map() }
  for (const [fileId, fileData] of files) {
    const parts = fileData.filePath.split("/")
    parts.pop()
    let cur = root
    for (const part of parts) {
      if (!cur.children.has(part)) {
        cur.children.set(part, { files: new Map(), children: new Map() })
      }
      cur = cur.children.get(part)!
    }
    cur.files.set(fileId, fileData)
  }
  return root
}

function countInTree(tree: DirTree): { files: number; symbols: number } {
  let files = tree.files.size
  let symbols = 0
  for (const f of tree.files.values()) symbols += f.symbols.length
  for (const child of tree.children.values()) {
    const sub = countInTree(child)
    files += sub.files
    symbols += sub.symbols
  }
  return { files, symbols }
}

function buildElkGraph(
  dirTree: DirTree,
  expandedDirs: Set<string>,
  expandedFiles: Set<string>,
  expandedClasses: Set<string>,
  graphData: GraphData,
  fileToDir: Map<string, string>,
): ElkNode {
  const symbolToFile = new Map<string, string>()
  for (const n of graphData.nodes) {
    if (n.kind !== "file") symbolToFile.set(n.id, `file:${n.file}`)
  }

  function visibleAncestor(fileId: string): string {
    const dirPath = fileToDir.get(fileId)
    if (!dirPath) return fileId
    const parts = dirPath.split("/")
    let accumulated = "dir:" + parts[0]
    if (!expandedDirs.has(accumulated)) return accumulated
    for (let i = 1; i < parts.length; i++) {
      accumulated += "/" + parts[i]
      if (!expandedDirs.has(accumulated)) return accumulated
    }
    return fileId
  }

  function parentContainer(nodeId: string): string {
    if (nodeId.startsWith("file:")) {
      const dirPath = fileToDir.get(nodeId)
      if (!dirPath) return "root"
      const parts = dirPath.split("/")
      let accumulated = "dir:" + parts[0]
      let lastExpanded = expandedDirs.has(accumulated) ? accumulated : "root"
      for (let i = 1; i < parts.length; i++) {
        accumulated += "/" + parts[i]
        if (expandedDirs.has(accumulated)) lastExpanded = accumulated
        else break
      }
      return lastExpanded
    }
    if (nodeId.startsWith("dir:")) {
      const inner = nodeId.slice(4)
      const parts = inner.split("/")
      if (parts.length <= 1) return "root"
      const parentParts = parts.slice(0, -1)
      return "dir:" + parentParts.join("/")
    }
    return "root"
  }

  const containerEdges = new Map<string, ElkExtendedEdge[]>()
  containerEdges.set("root", [])

  function buildDirElk(dirName: string, dir: DirTree, dirId: string): ElkNode {
    const isExpanded = expandedDirs.has(dirId)

    if (!isExpanded) {
      return {
        id: dirId,
        width: DIR_COLLAPSED_W,
        height: DIR_COLLAPSED_H,
      }
    }

    containerEdges.set(dirId, [])
    const children: ElkNode[] = []

    for (const [childName, childTree] of [...dir.children.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      children.push(buildDirElk(childName, childTree, dirId + "/" + childName))
    }

    for (const [fileId, fileData] of dir.files) {
      children.push({
        id: fileId,
        width: FILE_W,
        height: fileHeight(fileData, fileId, expandedFiles, expandedClasses),
      })
    }

    return {
      id: dirId,
      children,
      layoutOptions: {
        ...ELK_OPTS,
        "elk.padding": "[top=48,left=20,bottom=20,right=20]",
      },
    }
  }

  const topChildren: ElkNode[] = []
  const order = ["frontend", "shared", "backend"]
  const sorted = [...dirTree.children.entries()].sort((a, b) =>
    (order.indexOf(a[0]) === -1 ? 99 : order.indexOf(a[0])) -
    (order.indexOf(b[0]) === -1 ? 99 : order.indexOf(b[0]))
  )

  for (const [dirName, dt] of sorted) {
    topChildren.push(buildDirElk(dirName, dt, `dir:${dirName}`))
  }

  for (const [fileId, fileData] of dirTree.files) {
    topChildren.push({
      id: fileId,
      width: FILE_W,
      height: fileHeight(fileData, fileId, expandedFiles, expandedClasses),
    })
  }

  const allNodeIds = new Set<string>()
  function collectIds(node: ElkNode) {
    allNodeIds.add(node.id)
    if (node.children) node.children.forEach(collectIds)
  }
  topChildren.forEach(collectIds)

  const edgeSeen = new Set<string>()

  for (const e of graphData.edges) {
    const srcFile = symbolToFile.get(e.source)
    const tgtFile = symbolToFile.get(e.target)
    if (!srcFile || !tgtFile) continue

    const srcVisible = visibleAncestor(srcFile)
    const tgtVisible = visibleAncestor(tgtFile)
    if (srcVisible === tgtVisible) continue
    if (!allNodeIds.has(srcVisible) || !allNodeIds.has(tgtVisible)) continue

    const srcParent = parentContainer(srcVisible)
    const tgtParent = parentContainer(tgtVisible)

    let edgeSrc = srcVisible
    let edgeTgt = tgtVisible
    let edgeContainer = "root"

    if (srcParent === tgtParent) {
      edgeContainer = srcParent
    } else {
      // Find the lowest common ancestor (LCA) of both endpoints.
      // Walk up the container hierarchy for each endpoint to build ancestor chains,
      // then find the deepest shared expanded container.
      function ancestorChain(nodeId: string): string[] {
        const chain: string[] = []
        let cur = nodeId
        while (cur !== "root") {
          cur = parentContainer(cur)
          chain.push(cur)
        }
        return chain
      }
      const srcChain = new Set(ancestorChain(srcVisible))
      const tgtAncestors = ancestorChain(tgtVisible)
      let lca = "root"
      for (const a of tgtAncestors) {
        if (srcChain.has(a)) { lca = a; break }
      }
      edgeContainer = lca

      // Collapse each endpoint to the direct child of the LCA
      function collapseToChildOf(nodeId: string, container: string): string {
        if (parentContainer(nodeId) === container) return nodeId
        let cur = nodeId
        let prev = nodeId
        while (cur !== "root") {
          const up = parentContainer(cur)
          if (up === container) return cur
          prev = cur
          cur = up
        }
        return prev
      }
      edgeSrc = collapseToChildOf(srcVisible, lca)
      edgeTgt = collapseToChildOf(tgtVisible, lca)
      if (edgeSrc === edgeTgt) continue
      if (!allNodeIds.has(edgeSrc) || !allNodeIds.has(edgeTgt)) continue
    }

    const edgeKey = `${edgeContainer}:${edgeSrc}->${edgeTgt}`
    if (edgeSeen.has(edgeKey)) continue
    edgeSeen.add(edgeKey)

    const list = containerEdges.get(edgeContainer)
    if (list) {
      list.push({
        id: edgeKey,
        sources: [edgeSrc],
        targets: [edgeTgt],
      })
    }
  }

  function attachEdges(node: ElkNode): ElkNode {
    const nodeEdges = containerEdges.get(node.id)
    if (nodeEdges && nodeEdges.length > 0) {
      node.edges = nodeEdges
    }
    if (node.children) {
      node.children = node.children.map(attachEdges)
    }
    return node
  }

  const rootNode: ElkNode = {
    id: "root",
    children: topChildren.map(attachEdges),
    edges: containerEdges.get("root") ?? [],
    layoutOptions: {
      ...ELK_OPTS,
      "elk.padding": "[top=20,left=20,bottom=20,right=20]",
    },
  }

  return rootNode
}

function extractPositions(
  elkNode: ElkNode,
  positions: Map<string, { x: number; y: number; width: number; height: number }>,
) {
  if (elkNode.children) {
    for (const child of elkNode.children) {
      positions.set(child.id, {
        x: child.x ?? 0,
        y: child.y ?? 0,
        width: child.width ?? 0,
        height: child.height ?? 0,
      })
      extractPositions(child, positions)
    }
  }
}

function elkToReactFlow(
  elkRoot: ElkNode,
  dirTree: DirTree,
  expandedDirs: Set<string>,
  expandedFiles: Set<string>,
  expandedClasses: Set<string>,
  onToggleDir: (id: string) => void,
  onToggleFile: (id: string) => void,
  onToggleClass: (id: string) => void,
): { nodes: Node[]; edges: Edge[] } {
  const positions = new Map<string, { x: number; y: number; width: number; height: number }>()
  extractPositions(elkRoot, positions)

  const nodes: Node[] = []

  function addDirNodes(dir: DirTree, dirId: string, depth: number, parentId?: string) {
    const isExpanded = expandedDirs.has(dirId)
    const counts = countInTree(dir)
    const pos = positions.get(dirId)
    if (!pos) return

    const dirName = dirId.includes("/") ? dirId.split("/").pop()! : dirId.replace("dir:", "")

    nodes.push({
      id: dirId,
      type: "dirGroup",
      position: { x: pos.x, y: pos.y },
      ...(parentId ? { parentId, extent: "parent" as any } : {}),
      style: isExpanded
        ? {
            width: pos.width,
            height: pos.height,
          }
        : undefined,
      data: {
        label: dirName,
        fileCount: counts.files,
        symbolCount: counts.symbols,
        expanded: isExpanded,
        depth,
        onToggle: onToggleDir,
      } satisfies DirGroupData,
    })

    if (isExpanded) {
      for (const [childName, childTree] of dir.children) {
        addDirNodes(childTree, dirId + "/" + childName, depth + 1, dirId)
      }
      for (const [fileId, fileData] of dir.files) {
        const fpos = positions.get(fileId)
        if (!fpos) continue
        nodes.push({
          id: fileId,
          type: "fileGroup",
          position: { x: fpos.x, y: fpos.y },
          parentId: dirId,
          extent: "parent" as any,
          data: {
            label: fileData.label,
            filePath: fileData.filePath,
            symbols: fileData.symbols,
            expanded: expandedFiles.has(fileId),
            onToggle: onToggleFile,
            onToggleClass,
            expandedClasses,
          } satisfies FileGroupData,
        })
      }
    }
  }

  for (const [dirName, dt] of dirTree.children) {
    addDirNodes(dt, `dir:${dirName}`, 0)
  }

  for (const [fileId, fileData] of dirTree.files) {
    const fpos = positions.get(fileId)
    if (!fpos) continue
    nodes.push({
      id: fileId,
      type: "fileGroup",
      position: { x: fpos.x, y: fpos.y },
      data: {
        label: fileData.label,
        filePath: fileData.filePath,
        symbols: fileData.symbols,
        expanded: expandedFiles.has(fileId),
        onToggle: onToggleFile,
        onToggleClass,
        expandedClasses,
      } satisfies FileGroupData,
    })
  }

  const edges: Edge[] = []
  function collectEdges(node: ElkNode) {
    if (node.edges) {
      for (const e of node.edges) {
        edges.push({
          id: e.id,
          source: (e as ElkExtendedEdge).sources[0],
          target: (e as ElkExtendedEdge).targets[0],
          type: "smoothstep",
          style: { stroke: "#5a5a70", strokeWidth: 1.2 },
          animated: false,
        })
      }
    }
    if (node.children) node.children.forEach(collectEdges)
  }
  collectEdges(elkRoot)

  return { nodes, edges }
}

function GraphViewInner({ focusFile }: { focusFile?: string }) {
  const [graphData, setGraphData] = useState<GraphData | null>(null)
  const [loading, setLoading] = useState(true)
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set())
  const [expandedClasses, setExpandedClasses] = useState<Set<string>>(new Set())
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [layouting, setLayouting] = useState(false)
  const { fitView } = useReactFlow()

  useEffect(() => {
    fetch("/api/graph")
      .then((r) => r.json())
      .then((data: GraphData) => {
        setGraphData(data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const onToggleDir = useCallback((dirId: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev)
      if (next.has(dirId)) {
        for (const k of prev) {
          if (k === dirId || k.startsWith(dirId + "/")) next.delete(k)
        }
      } else {
        next.add(dirId)
      }
      return next
    })
  }, [])

  const onToggleFile = useCallback((fileId: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev)
      if (next.has(fileId)) next.delete(fileId)
      else next.add(fileId)
      return next
    })
  }, [])

  const onToggleClass = useCallback((classId: string) => {
    setExpandedClasses((prev) => {
      const next = new Set(prev)
      if (next.has(classId)) next.delete(classId)
      else next.add(classId)
      return next
    })
  }, [])

  const { files, fileToDir } = useMemo(() => {
    if (!graphData) return { files: new Map<string, FileInfo>(), fileToDir: new Map<string, string>() }
    const m = new Map<string, FileInfo>()
    const ftd = new Map<string, string>()

    for (const n of graphData.nodes) {
      if (n.kind === "file") {
        m.set(n.id, { filePath: n.file, label: n.name, symbols: [] })
        const parts = n.file.split("/")
        parts.pop()
        if (parts.length > 0) ftd.set(n.id, parts.join("/"))
      }
    }
    for (const n of graphData.nodes) {
      if (n.kind !== "file") {
        const fileEntry = m.get(`file:${n.file}`)
        if (fileEntry) {
          fileEntry.symbols.push({ id: n.id, kind: n.kind, name: n.name, parent: n.parent })
        }
      }
    }
    return { files: m, fileToDir: ftd }
  }, [graphData])

  const dirTree = useMemo(() => buildDirTree(files), [files])

  useEffect(() => {
    if (!focusFile || files.size === 0) return

    const fileId = `file:${focusFile}`
    const dirPath = fileToDir.get(fileId)
    if (!dirPath) return

    setExpandedDirs((prev) => {
      const next = new Set(prev)
      const parts = dirPath.split("/")
      let acc = "dir:" + parts[0]
      next.add(acc)
      for (let i = 1; i < parts.length; i++) {
        acc += "/" + parts[i]
        next.add(acc)
      }
      return next
    })
  }, [focusFile, files, fileToDir])

  useEffect(() => {
    if (!graphData || files.size === 0) return

    const elkGraph = buildElkGraph(dirTree, expandedDirs, expandedFiles, expandedClasses, graphData, fileToDir)

    setLayouting(true)
    elk.layout(elkGraph).then((layouted) => {
      const { nodes: rfNodes, edges: rfEdges } = elkToReactFlow(
        layouted, dirTree, expandedDirs, expandedFiles, expandedClasses,
        onToggleDir, onToggleFile, onToggleClass,
      )
      setNodes(rfNodes)
      setEdges(rfEdges)
      setLayouting(false)
      const focusNodeId = focusFile ? `file:${focusFile}` : undefined
      const focusNode = focusNodeId ? rfNodes.find((n) => n.id === focusNodeId) : undefined
      setTimeout(() => {
        if (focusNode) {
          fitView({ nodes: [focusNode], padding: 0.5, duration: 300 })
        } else {
          fitView({ padding: 0.12, duration: 300 })
        }
      }, 50)
    }).catch(() => {
      setLayouting(false)
    })
  }, [graphData, files, dirTree, expandedDirs, expandedFiles, expandedClasses, fileToDir, onToggleDir, onToggleFile, onToggleClass])

  if (loading) {
    return <div className="graph-loading">Loading dependency graph…</div>
  }
  if (!graphData) {
    return <div className="graph-loading">Failed to load graph data.</div>
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.12 }}
      minZoom={0.05}
      maxZoom={2}
      defaultEdgeOptions={{
        type: "smoothstep",
        style: { stroke: "#5a5a70", strokeWidth: 1.2 },
      }}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#2a2a30" />
      <Controls showInteractive={false} />
      <MiniMap
        nodeColor={(n) => (n.type === "dirGroup" ? "transparent" : "#34343a")}
        maskColor="rgba(0,0,0,0.6)"
        style={{ background: "#1a1a1d" }}
      />
      {layouting && (
        <Panel position="top-center">
          <div className="graph-layouting">laying out…</div>
        </Panel>
      )}
    </ReactFlow>
  )
}

export function GraphView({ focusFile }: { focusFile?: string }) {
  return (
    <div className="graph-view">
      <ReactFlowProvider>
        <GraphViewInner focusFile={focusFile} />
      </ReactFlowProvider>
    </div>
  )
}
