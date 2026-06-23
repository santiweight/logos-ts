import { pathToFileURL } from "node:url"
import { resolve } from "node:path"

const { buildArchContext } = await import(pathToFileURL(resolve("src/context.ts")).href) as typeof import("../../src/context.js")

const context = buildArchContext(".", ["run:studio-app"], 40000)

if (!context.includes("for change to: run:studio-app")) {
  throw new Error("run target context was not generated for run:studio-app")
}

if (!context.includes("## studio/package.json")) {
  throw new Error("run target context is missing the Studio package.json")
}

if (!context.includes("## src/detect-project.ts")) {
  throw new Error("run target context is missing the run-target detector provenance")
}

if (!context.includes("LOGOS_PROJECT") || !context.includes("LOGOS_STARTUP_PROJECT")) {
  throw new Error("run target context is missing the recursive Studio target env")
}
