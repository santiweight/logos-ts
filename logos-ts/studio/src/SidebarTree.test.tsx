import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { SidebarTree, buildData } from "./SidebarTree"
import type { FileEntry, Goal } from "./types"

const originalResizeObserver = globalThis.ResizeObserver

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
  }
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, value: 260 })
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 600 })
})

afterEach(cleanup)

afterAll(() => {
  globalThis.ResizeObserver = originalResizeObserver
})

const files: FileEntry[] = [{
  file: "src/components/JobCard.tsx",
  code: "",
  items: [{
    kind: "function",
    name: "JobCard",
    signature: "JobCard()",
    code: "",
    deps: [],
    tests: [],
  }],
  component: {
    name: "JobCard",
    signature: "JobCard()",
    componentCode: "",
    propsFields: [],
    stories: [{ id: "jobcard--default", exportName: "Default", snapshot: "<article>After</article>" }],
  },
}]

describe("SidebarTree", () => {
  it("rolls snapshot diff coloring up to the parent component row", () => {
    render(
      <SidebarTree
        files={files}
        selection={{ file: "src/components/JobCard.tsx", view: "code" }}
        onSelect={() => {}}
        comments={{}}
        onComment={() => {}}
        diff={{
          "component:JobCard": "changed",
        }}
        testState={null}
      />
    )

    expect(screen.getByText("JobCard").closest(".anode")).toHaveClass("diff-changed")
  })

  it("opens comments from nested component rows with sibling functions", () => {
    const onComment = vi.fn()
    render(
      <SidebarTree
        files={[{
          file: "app/admin/taxonomy/page.tsx",
          code: "",
          items: [
            {
              kind: "function",
              name: "saveTaxonomy",
              signature: "saveTaxonomy()",
              code: "",
              deps: [],
              tests: [],
            },
            {
              kind: "function",
              name: "AdminTaxonomyPage",
              signature: "AdminTaxonomyPage()",
              code: "",
              deps: [],
              tests: [],
            },
          ],
          component: {
            name: "AdminTaxonomyPage",
            signature: "AdminTaxonomyPage(props: { searchParams: SearchParams })",
            componentCode: "",
            propsFields: [{ name: "searchParams", type: "SearchParams" }],
            stories: [],
          },
        }]}
        selection={{ file: "app/admin/taxonomy/page.tsx", view: "code" }}
        onSelect={() => {}}
        comments={{}}
        onComment={onComment}
        diff={{}}
        testState={null}
      />
    )

    fireEvent.click(screen.getByText("AdminTaxonomyPage"), { altKey: true, clientX: 10, clientY: 20 })

    expect(onComment).toHaveBeenCalledWith("component:AdminTaxonomyPage", "AdminTaxonomyPage", 10, 20)
  })

  it("can hide function-only rows while keeping component rows visible", () => {
    render(
      <SidebarTree
        files={[
          {
            file: "app/admin/taxonomy/page.tsx",
            code: "",
            items: [
              {
                kind: "function",
                name: "saveTaxonomy",
                signature: "saveTaxonomy()",
                code: "",
                deps: [],
                tests: [],
              },
              {
                kind: "function",
                name: "AdminTaxonomyPage",
                signature: "AdminTaxonomyPage()",
                code: "",
                deps: [],
                tests: [],
              },
            ],
            component: {
              name: "AdminTaxonomyPage",
              signature: "AdminTaxonomyPage(props: { searchParams: SearchParams })",
              componentCode: "",
              propsFields: [],
              stories: [],
            },
          },
          {
            file: "app/admin/taxonomy/utils.ts",
            code: "",
            items: [{
              kind: "function",
              name: "normalizeTaxonomy",
              signature: "normalizeTaxonomy()",
              code: "",
              deps: [],
              tests: [],
            }],
          },
        ]}
        selection={{ file: "app/admin/taxonomy/page.tsx", view: "code" }}
        onSelect={() => {}}
        comments={{}}
        onComment={() => {}}
        diff={{}}
        testState={null}
        showFunctions={false}
      />
    )

    expect(screen.getByText("AdminTaxonomyPage")).toBeInTheDocument()
    expect(screen.queryByText("saveTaxonomy")).not.toBeInTheDocument()
    expect(screen.queryByText("normalizeTaxonomy")).not.toBeInTheDocument()
  })

  it("keeps classes visible when functions are hidden", () => {
    render(
      <SidebarTree
        files={[{
          file: "app/admin/taxonomy/store.ts",
          code: "",
          items: [
            {
              kind: "function",
              name: "saveTaxonomy",
              signature: "saveTaxonomy()",
              code: "",
              deps: [],
              tests: [],
            },
            {
              kind: "class",
              name: "TaxonomyStore",
              fields: [],
              methods: [],
              deps: [],
              tests: [],
              code: "",
            },
          ],
        }]}
        selection={{ file: "app/admin/taxonomy/store.ts", view: "code" }}
        onSelect={() => {}}
        comments={{}}
        onComment={() => {}}
        diff={{}}
        testState={null}
        showFunctions={false}
        showClasses={true}
      />
    )

    fireEvent.click(screen.getByText("store"))

    expect(screen.getByText("TaxonomyStore")).toBeInTheDocument()
    expect(screen.queryByText("saveTaxonomy")).not.toBeInTheDocument()
  })

  it("can hide React components without showing their backing function rows", () => {
    render(
      <SidebarTree
        files={[{
          file: "app/admin/taxonomy/page.tsx",
          code: "",
          items: [
            {
              kind: "function",
              name: "AdminTaxonomyPage",
              signature: "AdminTaxonomyPage()",
              code: "",
              deps: [],
              tests: [],
            },
            {
              kind: "function",
              name: "saveTaxonomy",
              signature: "saveTaxonomy()",
              code: "",
              deps: [],
              tests: [],
            },
          ],
          component: {
            name: "AdminTaxonomyPage",
            signature: "AdminTaxonomyPage(props: { searchParams: SearchParams })",
            componentCode: "",
            propsFields: [],
            stories: [],
          },
        }]}
        selection={{ file: "app/admin/taxonomy/page.tsx", view: "code" }}
        onSelect={() => {}}
        comments={{}}
        onComment={() => {}}
        diff={{}}
        testState={null}
        showComponents={false}
      />
    )

    expect(screen.getByText("saveTaxonomy")).toBeInTheDocument()
    expect(screen.queryByText("AdminTaxonomyPage")).not.toBeInTheDocument()
  })
})

function makeGoal(overrides: Partial<Goal> & { target: string }): Goal {
  return {
    id: `goal-${Math.random()}`,
    text: "test",
    label: "test",
    mode: "code",
    createdAt: Date.now(),
    status: "done",
    ...overrides,
  }
}

function findNode(nodes: any[], id: string): { comments?: number } | undefined {
  for (const n of nodes) {
    if (n.id === id) return n as { comments?: number }
    if (n.children) {
      const found = findNode(n.children as any[], id)
      if (found) return found
    }
  }
  return undefined
}

describe("buildData comment counts", () => {
  const twoComponentFiles: FileEntry[] = [
    {
      file: "frontend/components/FactTable.tsx",
      code: "",
      items: [{ kind: "function", name: "FactTable", signature: "FactTable()", code: "", deps: [], tests: [] }],
      component: {
        name: "FactTable",
        signature: "FactTable()",
        componentCode: "",
        propsFields: [],
        stories: [
          { id: "components-facttable--complete", exportName: "Complete", snapshot: null },
          { id: "components-facttable--empty", exportName: "Empty", snapshot: null },
        ],
      },
    },
    {
      file: "frontend/components/JobTable.tsx",
      code: "",
      items: [{ kind: "function", name: "JobTable", signature: "JobTable()", code: "", deps: [], tests: [] }],
      component: {
        name: "JobTable",
        signature: "JobTable()",
        componentCode: "",
        propsFields: [],
        stories: [{ id: "components-jobtable--default", exportName: "Default", snapshot: null }],
      },
    },
  ]

  it("story leaf gets its own count", () => {
    const goals: Record<string, Goal[]> = {
      "component:FactTable": [
        makeGoal({ target: "component:FactTable", storyId: "components-facttable--complete" }),
      ],
    }
    const { data } = buildData(twoComponentFiles, {}, goals, null, true, true, true)
    const story = findNode(data, "story:components-facttable--complete")
    expect(story?.comments).toBe(1)
  })

  it("sibling story with no comments has no count", () => {
    const goals: Record<string, Goal[]> = {
      "component:FactTable": [
        makeGoal({ target: "component:FactTable", storyId: "components-facttable--complete" }),
      ],
    }
    const { data } = buildData(twoComponentFiles, {}, goals, null, true, true, true)
    const empty = findNode(data, "story:components-facttable--empty")
    expect(empty?.comments ?? 0).toBe(0)
  })

  it("component rolls up from story children", () => {
    const goals: Record<string, Goal[]> = {
      "component:FactTable": [
        makeGoal({ target: "component:FactTable", storyId: "components-facttable--complete" }),
        makeGoal({ target: "component:FactTable", storyId: "components-facttable--complete" }),
        makeGoal({ target: "component:FactTable", storyId: "components-facttable--empty" }),
      ],
    }
    const { data } = buildData(twoComponentFiles, {}, goals, null, true, true, true)
    const comp = findNode(data, "comp:FactTable")
    expect(comp?.comments).toBe(3)
  })

  it("directory rolls up from all descendants", () => {
    const goals: Record<string, Goal[]> = {
      "component:FactTable": [
        makeGoal({ target: "component:FactTable", storyId: "components-facttable--complete" }),
      ],
      "component:JobTable": [
        makeGoal({ target: "component:JobTable", storyId: "components-jobtable--default" }),
      ],
    }
    const { data } = buildData(twoComponentFiles, {}, goals, null, true, true, true)
    const frontend = findNode(data, "dir:frontend")
    const components = findNode(data, "dir:frontend/components")
    expect(components?.comments).toBe(2)
    expect(frontend?.comments).toBe(2)
  })

  it("component with no story comments shows 0", () => {
    const { data } = buildData(twoComponentFiles, {}, {}, null, true, true, true)
    const comp = findNode(data, "comp:FactTable")
    expect(comp?.comments).toBe(0)
  })
})
