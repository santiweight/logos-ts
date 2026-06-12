#!/usr/bin/env node

import { spawn } from "node:child_process"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

if (process.env.LOGOS_REQUIRE_AUTH === "1" && !process.env.LOGOS_AUTH_PASSWORD) {
  console.error("LOGOS_AUTH_PASSWORD is required when LOGOS_REQUIRE_AUTH=1")
  process.exit(1)
}

if (!process.env.ANTHROPIC_API_KEY && !process.env.CLAUDE_CODE_OAUTH_TOKEN) {
  console.error("ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN is required")
  process.exit(1)
}

const studio = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const port = process.env.PORT || "8080"
const vite = resolve(studio, "node_modules/.bin/vite")
const child = spawn(vite, ["--host", "0.0.0.0", "--port", port, "--strictPort"], {
  cwd: studio,
  env: process.env,
  stdio: "inherit",
})

const stop = (signal) => {
  child.kill(signal)
}

process.on("SIGINT", () => stop("SIGINT"))
process.on("SIGTERM", () => stop("SIGTERM"))
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 1)
})
