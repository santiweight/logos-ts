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

  it("offers story generation from the component context menu", () => {
    const onSelect = vi.fn()
    const onWriteStories = vi.fn()
    render(
      <SidebarTree
        files={files}
        selection={{ file: "src/components/JobCard.tsx", view: "code" }}
        onSelect={onSelect}
        comments={{}}
        onComment={() => {}}
        onWriteStories={onWriteStories}
        diff={{}}
        testState={null}
      />
    )

    fireEvent.contextMenu(screen.getByText("JobCard"))

    expect(onSelect).toHaveBeenCalledWith({
      file: "src/components/JobCard.tsx",
      component: "JobCard",
      view: "story",
      storyId: "jobcard--default",
    })
    expect(onWriteStories).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "Generate stories" }))

    expect(onWriteStories).toHaveBeenCalledWith("component:JobCard", "JobCard")
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

  it("shows Play for stopped app runs and starts them when the row is clicked", () => {
    const onRun = vi.fn()
    const onSelect = vi.fn()
    render(
      <SidebarTree
        files={files}
        selection={{ file: "src/components/JobCard.tsx", view: "code" }}
        onSelect={onSelect}
        comments={{}}
        onComment={() => {}}
        diff={{}}
        testState={null}
        runTargets={[{
          id: "root-app",
          label: "App",
          cwd: "/tmp/app",
          command: "pnpm",
          args: ["dev"],
          framework: "vite",
        }]}
        onRun={onRun}
      />
    )

    expect(screen.getByTitle("Play")).toHaveTextContent("▶")

    fireEvent.click(screen.getByText("App"))

    expect(onSelect).toHaveBeenCalledWith({ file: "", view: "run", runTargetId: "root-app" })
    expect(onRun).toHaveBeenCalledWith("root-app")
  })

  it("shows Restart for ready app runs", () => {
    const onRun = vi.fn()
    render(
      <SidebarTree
        files={files}
        selection={{ file: "", view: "run", runTargetId: "root-app" }}
        onSelect={() => {}}
        comments={{}}
        onComment={() => {}}
        diff={{}}
        testState={null}
        runTargets={[{
          id: "root-app",
          label: "App",
          cwd: "/tmp/app",
          command: "pnpm",
          args: ["dev"],
          framework: "vite",
        }]}
        runStates={{
          "root-app": {
            id: "ws-1:root-app",
            workspaceId: "ws-1",
            targetId: "root-app",
            status: "ready",
            startedAt: 1000,
            logs: [],
          },
        }}
        onRun={onRun}
      />
    )

    fireEvent.click(screen.getByTitle("Restart"))

    expect(onRun).toHaveBeenCalledWith("root-app", true)
  })

  it("shows Delete folder in context menu for directories", () => {
    const onDelete = vi.fn()
    window.confirm = vi.fn(() => true)
    render(
      <SidebarTree
        files={[
          {
            file: "src/utils/helpers.ts",
            code: "",
            items: [{ kind: "function", name: "helpers", signature: "helpers()", code: "", deps: [], tests: [] }],
          },
        ]}
        selection={{ file: "src/utils/helpers.ts", view: "code" }}
        onSelect={() => {}}
        comments={{}}
        onComment={() => {}}
        onDelete={onDelete}
        diff={{}}
        testState={null}
      />
    )

    fireEvent.contextMenu(screen.getByText("src"))

    const deleteBtn = screen.getByRole("button", { name: "Delete folder" })
    expect(deleteBtn).toBeInTheDocument()
    fireEvent.click(deleteBtn)

    expect(window.confirm).toHaveBeenCalled()
    expect(onDelete).toHaveBeenCalledWith("src")
  })

  it("shows Delete file in context menu for files", () => {
    const onDelete = vi.fn()
    window.confirm = vi.fn(() => true)
    render(
      <SidebarTree
        files={[
          {
            file: "src/utils/format.ts",
            code: "",
            items: [
              { kind: "function", name: "formatDate", signature: "formatDate()", code: "", deps: [], tests: [] },
              { kind: "function", name: "formatName", signature: "formatName()", code: "", deps: [], tests: [] },
            ],
          },
        ]}
        selection={{ file: "src/utils/format.ts", view: "code" }}
        onSelect={() => {}}
        comments={{}}
        onComment={() => {}}
        onDelete={onDelete}
        diff={{}}
        testState={null}
      />
    )

    fireEvent.contextMenu(screen.getByText("format"))

    const deleteBtn = screen.getByRole("button", { name: "Delete file" })
    expect(deleteBtn).toBeInTheDocument()
    fireEvent.click(deleteBtn)

    expect(onDelete).toHaveBeenCalledWith("src/utils/format.ts")
  })

  it("shows Delete file for function symbols (deletes containing file)", () => {
    const onDelete = vi.fn()
    window.confirm = vi.fn(() => true)
    render(
      <SidebarTree
        files={[
          {
            file: "src/utils/parse.ts",
            code: "",
            items: [
              { kind: "function", name: "parseInput", signature: "parseInput()", code: "", deps: [], tests: [] },
              { kind: "function", name: "validateInput", signature: "validateInput()", code: "", deps: [], tests: [] },
            ],
          },
        ]}
        selection={{ file: "src/utils/parse.ts", view: "code" }}
        onSelect={() => {}}
        comments={{}}
        onComment={() => {}}
        onDelete={onDelete}
        diff={{}}
        testState={null}
      />
    )

    fireEvent.click(screen.getByText("parse"))
    fireEvent.contextMenu(screen.getByText("parseInput"))

    const deleteBtn = screen.getByRole("button", { name: "Delete file" })
    fireEvent.click(deleteBtn)

    expect(onDelete).toHaveBeenCalledWith("src/utils/parse.ts")
  })

  it("shows both Generate stories and Delete for components", () => {
    const onWriteStories = vi.fn()
    const onDelete = vi.fn()
    window.confirm = vi.fn(() => true)
    render(
      <SidebarTree
        files={files}
        selection={{ file: "src/components/JobCard.tsx", view: "code" }}
        onSelect={() => {}}
        comments={{}}
        onComment={() => {}}
        onWriteStories={onWriteStories}
        onDelete={onDelete}
        diff={{}}
        testState={null}
      />
    )

    fireEvent.contextMenu(screen.getByText("JobCard"))

    expect(screen.getByRole("button", { name: "Generate stories" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Delete file" })).toBeInTheDocument()
  })

  it("does not call onDelete when confirm is cancelled", () => {
    const onDelete = vi.fn()
    window.confirm = vi.fn(() => false)
    render(
      <SidebarTree
        files={files}
        selection={{ file: "src/components/JobCard.tsx", view: "code" }}
        onSelect={() => {}}
        comments={{}}
        onComment={() => {}}
        onDelete={onDelete}
        diff={{}}
        testState={null}
      />
    )

    fireEvent.contextMenu(screen.getByText("JobCard"))
    fireEvent.click(screen.getByRole("button", { name: "Delete file" }))

    expect(window.confirm).toHaveBeenCalled()
    expect(onDelete).not.toHaveBeenCalled()
  })

  it("does not show context menu for run targets", () => {
    const onDelete = vi.fn()
    render(
      <SidebarTree
        files={files}
        selection={{ file: "src/components/JobCard.tsx", view: "code" }}
        onSelect={() => {}}
        comments={{}}
        onComment={() => {}}
        onDelete={onDelete}
        diff={{}}
        testState={null}
        runTargets={[{
          id: "root-app",
          label: "App",
          cwd: "/tmp/app",
          command: "pnpm",
          args: ["dev"],
          framework: "vite",
        }]}
      />
    )

    fireEvent.contextMenu(screen.getByText("App"))

    expect(screen.queryByRole("button", { name: /Delete/ })).not.toBeInTheDocument()
  })

  it("does not show delete button when onDelete is not provided", () => {
    render(
      <SidebarTree
        files={files}
        selection={{ file: "src/components/JobCard.tsx", view: "code" }}
        onSelect={() => {}}
        comments={{}}
        onComment={() => {}}
        diff={{}}
        testState={null}
      />
    )

    fireEvent.contextMenu(screen.getByText("JobCard"))

    expect(screen.queryByRole("button", { name: /Delete/ })).not.toBeInTheDocument()
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
