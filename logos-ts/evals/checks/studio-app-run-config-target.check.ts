import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

const { detectProject: detectProjectCaps } = await import(pathToFileURL(resolve("src/detect-project.ts")).href) as typeof import("../../src/detect-project.js")

const detectProjectSource = readFileSync("src/detect-project.ts", "utf8")
const hnJobsPackage = readFileSync("demos/hn-jobs/package.json", "utf8")
const studioConfig = readFileSync("studio/vite.config.ts", "utf8")

if (detectProjectSource.includes('LOGOS_PROJECT: "${WORKSPACE_ROOT}"') || detectProjectSource.includes('LOGOS_STARTUP_PROJECT: "${WORKSPACE_ROOT}"')) {
  throw new Error("recursive Studio App Run still forces LOGOS_PROJECT to the Logos Studio workspace")
}

if (!detectProjectSource.includes('${WORKSPACE_ROOT}/demos/hn-jobs')) {
  throw new Error("recursive Studio App Run does not point at the HN Jobs project")
}

if (hnJobsPackage.includes('"dev:mini"') || hnJobsPackage.includes("HN_JOBS_SKIP_SEED=1")) {
  throw new Error("HN Jobs demo must not define a mini run script")
}

const hnJobsRuns = detectProjectCaps("demos/hn-jobs").runs
const firstRun = hnJobsRuns[0]
if (!firstRun) throw new Error("HN Jobs has no detected run targets")
if (firstRun.id !== "root-app") {
  throw new Error(`HN Jobs app must be the first/default run target; got ${firstRun.id}`)
}
if (firstRun.label !== "App") {
  throw new Error(`HN Jobs first run target label must identify the app; got ${firstRun.label}`)
}
if (firstRun.command !== "pnpm") {
  throw new Error(`HN Jobs app run target must use pnpm; got ${firstRun.command}`)
}
if (firstRun.args[0] !== "dev" || firstRun.args.includes("dev:mini")) {
  throw new Error(`HN Jobs app run target must execute dev, not dev:mini; got ${firstRun.args.join(" ")}`)
}

const hnJobsIndex = studioConfig.indexOf('id: "hn-jobs"')
const logosStudioIndex = studioConfig.indexOf('id: "logos-studio"')
if (hnJobsIndex < 0) throw new Error("HN Jobs demo is missing from Studio demos")
if (logosStudioIndex < 0) throw new Error("Logos Studio demo is missing from Studio demos")
if (hnJobsIndex > logosStudioIndex) {
  throw new Error("HN Jobs must remain before Logos Studio so the no-override default is HN Jobs")
}
