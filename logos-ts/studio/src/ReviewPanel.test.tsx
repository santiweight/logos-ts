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
      stories: [{ id: `${component.toLowerCase()}--${exportName.toLowerCase()}`, exportName, snapshot: before }],
    },
  }
}

function index(files: FileEntry[]): StudioIndex {
  return { root: "/test", files }
}

function storyFile(storyCode: string): FileEntry {
  return {
    file: "components/JobRow.tsx",
    code: "",
    items: [],
    component: {
      name: "JobRow",
      signature: "JobRow()",
      componentCode: "export function JobRow() { return null }",
      propsFields: [],
      stories: [{
        id: "jobrow--default",
        exportName: "Default",
        storyFile: "components/JobRow.stories.tsx",
        storyCode,
        snapshot: null,
      }],
    },
  }
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
      },
    }])

    const { container } = render(
      <ReviewPanel
        base={base}
        workspace={workspace}
      />
    )

    expect(screen.getByText("components/JobCard.tsx")).toBeInTheDocument()
    expect(container.querySelectorAll(".review-file-card")).toHaveLength(1)
    const header = screen.getByRole("button", { name: /components\/JobCard\.tsx/ })
    expect(header).toHaveAttribute("aria-expanded", "false")
    expect(container.querySelector(".inline-diff-add")).toBeNull()

    fireEvent.click(header)
    expect(header).toHaveAttribute("aria-expanded", "true")
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
      />
    )

    fireEvent.click(screen.getByRole("button", { name: /JobRow \/ Default/ }))
    expect(screen.getByRole("button", { name: /JobRow \/ Default/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Snapshot diff" }))
    expect(screen.getByText("<div>Engineer</div>")).toBeInTheDocument()
    expect(screen.getByText("<div>Platform Engineer</div>")).toBeInTheDocument()
  })

  it("renders snapshot diffs for added indexed Vitest captures", () => {
    const base = index([])
    const workspace = index([
      capturedFile("JobRow", '"<div class=\\"row\\">Platform Engineer</div>"'),
    ])

    render(
      <ReviewPanel
        base={base}
        workspace={workspace}
      />
    )

    expect(screen.getByText("added")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Snapshot diff" }))

    expect(screen.getByText('<div class="row">Platform Engineer</div>')).toBeInTheDocument()
  })

  it("renders before and after visual snapshots from persisted HTML", () => {
    const base = index([capturedFile("JobRow", "<div>Engineer</div>")])
    const workspace = index([capturedFile("JobRow", "<div>Platform Engineer</div>")])
    const { container } = render(
      <ReviewPanel
        base={base}
        workspace={workspace}
      />
    )

    const frames = [...container.querySelectorAll("iframe.capture-preview-frame")]
    expect(frames).toHaveLength(2)
    expect(frames[0]?.getAttribute("srcdoc")).toContain("<div>Engineer</div>")
    expect(frames[0]?.getAttribute("srcdoc")).not.toContain("Platform Engineer")
    expect(frames[1]?.getAttribute("srcdoc")).toContain("<div>Platform Engineer</div>")
  })

  it("renders story-only changes as reviewable architecture diffs without snapshots", () => {
    const base = index([
      storyFile([
        "function StoryRender() {",
        "  return <td>{jobCount1247}</td>",
        "}",
        "export const Default = {};",
      ].join("\n")),
    ])
    const workspace = index([
      storyFile([
        "function StoryRender() {",
        "  return <td><strong>{jobCount1248}</strong></td>",
        "}",
        "export const Default = {};",
      ].join("\n")),
    ])

    const { container } = render(
      <ReviewPanel
        base={base}
        workspace={workspace}
      />
    )

    expect(screen.getByText("components/JobRow.stories.tsx")).toBeInTheDocument()
    const header = screen.getByRole("button", { name: /components\/JobRow\.stories\.tsx/ })
    fireEvent.click(header)

    const diffText = container.querySelector(".inline-diff")?.textContent
    expect(diffText).toContain("jobCount1247")
    expect(diffText).toContain("jobCount1248")
  })

})
