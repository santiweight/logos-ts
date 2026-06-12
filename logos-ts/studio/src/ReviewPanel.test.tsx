import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { ReviewPanel } from "./ReviewPanel"
import type { FileEntry, StudioIndex } from "./types"

afterEach(cleanup)

function capturedFile(component: string, before: string, exportName = "Default"): FileEntry {
  return {
    file: `components/${component}.tsx`,
    code: "",
    items: [],
    component: {
      name: component,
      signature: `${component}()`,
      componentCode: "",
      propsFields: [],
      stories: [{ id: `${component.toLowerCase()}--${exportName.toLowerCase()}`, exportName }],
      captured: [{
        exportName,
        testFile: `components/${component}.${exportName}.captured.test.tsx`,
        snapshot: before,
        previousSnapshot: null,
      }],
    },
  }
}

function index(files: FileEntry[]): StudioIndex {
  return { root: "/test", files }
}

describe("ReviewPanel", () => {
  it("renders architecture changes as file cards with highlighted TypeScript", () => {
    const base = index([{
      file: "components/JobCard.tsx",
      code: "",
      items: [{
        kind: "function",
        name: "parseJob",
        signature: "parseJob(rawText: string): ParsedJob",
        code: "",
        deps: [],
        tests: [],
      }],
      component: {
        name: "JobCard",
        signature: "JobCard(props: JobCardProps)",
        componentCode: "",
        propsName: "JobCardProps",
        propsCode: "interface JobCardProps { title: string }",
        propsFields: [{ name: "title", type: "string" }],
        stories: [],
        captured: [],
      },
    }])
    const workspace = index([{
      file: "components/JobCard.tsx",
      code: "",
      items: [{
        kind: "function",
        name: "parseJob",
        signature: "parseJob(rawText: string, rawHtml: string): ParsedJob",
        code: "",
        deps: [],
        tests: [],
      }],
      component: {
        name: "JobCard",
        signature: "JobCard(props: JobCardProps)",
        componentCode: "",
        propsName: "JobCardProps",
        propsCode: "interface JobCardProps { title: string; remote: boolean }",
        propsFields: [
          { name: "title", type: "string" },
          { name: "remote", type: "boolean" },
        ],
        stories: [],
        captured: [],
      },
    }])

    const { container } = render(
      <ReviewPanel
        base={base}
        workspace={workspace}
        storybookUrl=""
        storybookState={null}
        onRetryStorybook={() => {}}
      />
    )

    expect(screen.getByText("components/JobCard.tsx")).toBeInTheDocument()
    expect(container.querySelectorAll(".review-file-card")).toHaveLength(1)
    expect(container.querySelector(".inline-diff-add")).not.toBeNull()
    expect(container.querySelector(".tok-keyword")?.textContent).toBe("declare")
    expect(container.querySelector(".tok-type")?.textContent).toBe("string")
    expect([...container.querySelectorAll(".tok-function")].map((node) => node.textContent)).toContain("parseJob")
    expect([...container.querySelectorAll(".tok-ident")].map((node) => node.textContent)).toContain("rawText")
    expect([...container.querySelectorAll(".tok-symbol")].map((node) => node.textContent)).toContain("ParsedJob")
  })

  it("lists changed captures and opens the selected snapshot diff", () => {
    const base = index([
      capturedFile("JobRow", "<div>Engineer</div>"),
      capturedFile("FiltersSidebar", "<aside>Role</aside>"),
    ])
    const workspace = index([
      capturedFile("JobRow", "<div>Platform Engineer</div>"),
      capturedFile("FiltersSidebar", "<aside>Role and location</aside>"),
    ])

    render(
      <ReviewPanel
        base={base}
        workspace={workspace}
        storybookUrl=""
        storybookState={null}
        onRetryStorybook={() => {}}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: /JobRow \/ Default/ }))
    expect(screen.getAllByText("components/JobRow.Default.captured.test.tsx")).toHaveLength(2)

    fireEvent.click(screen.getByRole("button", { name: "Snapshot diff" }))
    expect(screen.getByText("<div>Engineer</div>")).toBeInTheDocument()
    expect(screen.getByText("<div>Platform Engineer</div>")).toBeInTheDocument()
  })
})
