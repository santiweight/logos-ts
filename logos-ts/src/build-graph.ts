import { resolve, relative } from "node:path"
import { loadProject } from "./project.js"
import { buildDependencyTree } from "./dependencies.js"

export interface GraphNode {
  id: string
  kind: "file" | "function" | "class" | "interface" | "type" | "enum" | "variable" | "method"
  name: string
  file: string
  parent?: string
}

export interface GraphEdge {
  source: string
  target: string
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export function buildGraph(root: string): GraphData {
  const absRoot = resolve(root)
  const project = loadProject(root)
  const sfs = project.getSourceFiles().filter((s) => !s.getFilePath().includes("/node_modules/"))
  const tree = buildDependencyTree(sfs, root)

  const nodes: GraphNode[] = []
  const fileSet = new Set<string>()
  const nodeIds = new Set<string>()

  for (const [qname] of tree) {
    nodeIds.add(qname)
    const [file, symbol] = qname.split("#")
    if (!fileSet.has(file)) {
      fileSet.add(file)
      nodes.push({ id: `file:${file}`, kind: "file", name: file.split("/").pop()!, file })
    }

    let kind: GraphNode["kind"] = "variable"
    if (symbol.includes(".")) {
      kind = "method"
    } else {
      const sf = sfs.find((s) => relative(absRoot, s.getFilePath()) === file)
      if (sf) {
        if (sf.getFunction(symbol)) kind = "function"
        else if (sf.getClass(symbol)) kind = "class"
        else if (sf.getInterface(symbol)) kind = "interface"
        else if (sf.getTypeAlias(symbol)) kind = "type"
        else if (sf.getEnum(symbol)) kind = "enum"
        else kind = "variable"
      }
    }

    const parentClass = symbol.includes(".") ? symbol.split(".")[0] : undefined
    const parent = parentClass ? `${file}#${parentClass}` : undefined

    nodes.push({ id: qname, kind, name: symbol, file, parent })
  }

  const edges: GraphEdge[] = []
  for (const [qname, deps] of tree) {
    for (const dep of deps) {
      if (nodeIds.has(dep)) {
        edges.push({ source: qname, target: dep })
      }
    }
  }

  return { nodes, edges }
}

// CLI: tsx src/build-graph.ts <root>
if (process.argv[1]?.endsWith("build-graph.ts")) {
  const [, , root = "../hn-jobs"] = process.argv
  const graph = buildGraph(root)
  process.stdout.write(JSON.stringify(graph))
}
