#!/usr/bin/env node

import { spawn } from "node:child_process"
import { resolve, dirname } from "node:path"
import { existsSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { homedir } from "node:os"
import { isolatedDevEnv } from "./dev-env.mjs"

const __dirname = dirname(fileURLToPath(import.meta.url))
const STUDIO = resolve(__dirname, "..")
const DEFAULT_PROJECT = resolve(homedir(), "projects/santiweightdotcom")

const args = process.argv.slice(2)
let projectRoot = null
let port = null

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--port" && args[i + 1]) {
    port = args[++i]
  } else if (!projectRoot) {
    projectRoot = resolve(args[i])
  }
}

projectRoot = projectRoot || DEFAULT_PROJECT

if (!existsSync(projectRoot)) {
  console.error(`Error: path does not exist: ${projectRoot}`)
  process.exit(1)
}

const hasTsFiles = readdirSync(projectRoot, { recursive: true })
  .some(f => typeof f === "string" && /\.(tsx?|jsx?)$/.test(f) && !f.includes("node_modules"))

if (!hasTsFiles) {
  console.warn(`Warning: no .ts/.tsx files found in ${projectRoot}`)
}

console.log(`\nLogos Studio`)
console.log(`  Project: ${projectRoot}`)
if (port) console.log(`  Port:    ${port} (preferred)`)
console.log()

const viteArgs = ["dev"]
if (port) viteArgs.push("--port", port)

const child = spawn(resolve(STUDIO, "node_modules/.bin/vite"), viteArgs, {
  cwd: STUDIO,
  env: isolatedDevEnv(projectRoot),
  stdio: "inherit",
})

process.on("SIGINT", () => { child.kill("SIGINT"); process.exit() })
process.on("SIGTERM", () => { child.kill("SIGTERM"); process.exit() })
child.on("exit", (code) => process.exit(code ?? 0))
