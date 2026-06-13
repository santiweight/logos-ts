import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { SidebarTree } from "./SidebarTree"
import type { FileEntry } from "./types"

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
    stories: [{ id: "jobcard--default", exportName: "Default" }],
    captured: [{
      exportName: "Default",
      testFile: "src/components/JobCard.Default.captured.test.tsx",
      snapshot: "<article>After</article>",
      previousSnapshot: "<article>Before</article>",
    }],
  },
}]

describe("SidebarTree", () => {
  it("rolls captured diff coloring up to the parent component row", () => {
    render(
      <SidebarTree
        files={files}
        selection={{ file: "src/components/JobCard.tsx", view: "code" }}
        onSelect={() => {}}
        comments={{}}
        onComment={() => {}}
        diff={{
          "capture:src/components/JobCard.Default.captured.test.tsx::Default": "changed",
        }}
        testState={null}
      />
    )

    expect(screen.getByText("JobCard").closest(".anode")).toHaveClass("diff-changed")
    fireEvent.click(screen.getByText("JobCard"))
    expect(screen.getByText(/captured/).closest(".anode")).toHaveClass("diff-changed")
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
            captured: [],
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
})
