#!/usr/bin/env node

import { spawn } from "node:child_process"
import { resolve, dirname } from "node:path"
import { existsSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const STUDIO = resolve(__dirname, "..")

const projectRoot = resolve(process.argv[2] || process.cwd())

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
console.log(`  Project: ${projectRoot}\n`)

const child = spawn("npx", ["vite", "dev"], {
  cwd: STUDIO,
  env: { ...process.env, LOGOS_PROJECT: projectRoot },
  stdio: "inherit",
})

process.on("SIGINT", () => { child.kill("SIGINT"); process.exit() })
process.on("SIGTERM", () => { child.kill("SIGTERM"); process.exit() })
child.on("exit", (code) => process.exit(code ?? 0))
