import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { buildStudioIndex } from "./build-index.js"

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function createProject(): string {
  const root = mkdtempSync(join(tmpdir(), "logos-build-index-"))
  tempDirs.push(root)
  mkdirSync(join(root, "components"), { recursive: true })
  writeFileSync(join(root, "package.json"), "{}")
  return root
}

describe("buildStudioIndex component detection", () => {
  it("enriches PascalCase JSX functions without Storybook stories", () => {
    const root = createProject()
    writeFileSync(join(root, "components", "FiltersSidebar.tsx"), `
      import type { ReactNode } from "react"

      export function FiltersSidebar({
        activeCount,
        children,
      }: {
        activeCount: number
        children: ReactNode
      }) {
        return <aside>{activeCount}{children}</aside>
      }
    `)

    const index = buildStudioIndex(root)
    const file = index.files.find((entry) => entry.file === "components/FiltersSidebar.tsx")

    expect(file?.component).toMatchObject({
      name: "FiltersSidebar",
      signature: expect.stringContaining("activeCount: number"),
      stories: [],
      propsFields: [
        { name: "activeCount", type: "number" },
        { name: "children", type: "ReactNode" },
      ],
    })
  })

  it("enriches React component variables from named props types", () => {
    const root = createProject()
    writeFileSync(join(root, "components", "SearchableFilter.tsx"), `
      import type { FC } from "react"

      interface SearchableFilterProps {
        title: string
        searchable?: boolean
      }

      export const SearchableFilter: FC<SearchableFilterProps> = ({ title }) => {
        return <section>{title}</section>
      }
    `)

    const index = buildStudioIndex(root)
    const file = index.files.find((entry) => entry.file === "components/SearchableFilter.tsx")

    expect(file?.component).toMatchObject({
      name: "SearchableFilter",
      signature: "SearchableFilter(props: SearchableFilterProps)",
      propsName: "SearchableFilterProps",
      propsFields: [
        { name: "title", type: "string" },
        { name: "searchable?", type: "boolean" },
      ],
    })
  })

  it("keeps every component when a file has multiple components", () => {
    const root = createProject()
    mkdirSync(join(root, "app", "job", "[slug]"), { recursive: true })
    writeFileSync(join(root, "app", "job", "[slug]", "page.tsx"), `
      export function JobPageView({ job }: { job: { title: string } }) {
        return <article>{job.title}</article>
      }

      export default async function JobPage({ params }: { params: { slug: string } }) {
        return <JobPageView job={{ title: params.slug }} />
      }
    `)
    writeFileSync(join(root, "app", "job", "[slug]", "page.stories.tsx"), `
      import type { Meta, StoryObj } from "@storybook/react"
      import { JobPageView } from "./page"

      const meta: Meta<typeof JobPageView> = {
        title: "Pages/JobPage",
        component: JobPageView,
      }

      export default meta
      type Story = StoryObj<typeof meta>
      export const Default: Story = { args: { job: { title: "Acme" } } }
    `)

    const index = buildStudioIndex(root)
    const file = index.files.find((entry) => entry.file === "app/job/[slug]/page.tsx")

    expect(file?.components?.map((component) => component.name)).toEqual(["JobPageView", "JobPage"])
    expect(file?.components?.find((component) => component.name === "JobPageView")?.stories).toEqual([
      { id: "pages-jobpage--default", exportName: "Default", snapshot: null },
    ])
    expect(file?.components?.find((component) => component.name === "JobPage")?.stories).toEqual([])
  })
})
