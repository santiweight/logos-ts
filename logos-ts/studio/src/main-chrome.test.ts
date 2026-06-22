import { describe, expect, it } from "vitest"
import { mainChromeState } from "./main-chrome"
import type { FileEntry, RunTarget } from "./types"

const componentFile: FileEntry = {
  file: "components/JobCard.tsx",
  code: "",
  items: [],
  component: {
    name: "JobCard",
    signature: "JobCard()",
    componentCode: "",
    propsFields: [],
    stories: [{ id: "jobcard--default", exportName: "Default", snapshot: null }],
  },
}

const appTarget: RunTarget = {
  id: "root-app",
  label: "App",
  cwd: "/project",
  command: "pnpm",
  args: ["dev"],
}

describe("mainChromeState", () => {
  it("shows the selected component title above Live and Changes", () => {
    expect(mainChromeState({
      selection: { file: componentFile.file, component: "JobCard", view: "code" },
      currentFile: componentFile,
      runTarget: null,
      reviewOpen: false,
      reviewCount: 0,
    })).toEqual({
      title: "/components/JobCard",
      showModeTabs: true,
      changesOpen: false,
      changesLabel: "Changes",
    })
  })

  it("keeps Changes isolated to file/component selections", () => {
    expect(mainChromeState({
      selection: { file: componentFile.file, component: "JobCard", view: "code" },
      currentFile: componentFile,
      runTarget: null,
      reviewOpen: true,
      reviewCount: 1,
    })).toMatchObject({
      showModeTabs: true,
      changesOpen: true,
      changesLabel: "Changes 1",
    })
  })

  it("hides Live and Changes for the app even if Changes was open", () => {
    expect(mainChromeState({
      selection: { file: "", view: "run", runTargetId: "root-app" },
      currentFile: componentFile,
      runTarget: appTarget,
      reviewOpen: true,
      reviewCount: 1,
    })).toEqual({
      title: "App",
      showModeTabs: false,
      changesOpen: false,
      changesLabel: "Changes 1",
    })
  })
})
