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
