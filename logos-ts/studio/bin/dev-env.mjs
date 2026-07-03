import { createHash, randomBytes } from "node:crypto"
import { mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { basename, resolve } from "node:path"

const BASE_ENV_KEYS = [
  "PATH",
  "HOME",
  "SHELL",
  "USER",
  "TMPDIR",
  "TEMP",
  "TMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "SSH_AUTH_SOCK",
  "COREPACK_HOME",
  "NVM_BIN",
  "NVM_DIR",
  "PNPM_HOME",
  "VOLTA_HOME",
]

const LOGOS_ENV_KEYS = [
  "LOGOS_AGENT_RUNS_DIR",
  "LOGOS_ALLOWED_HOSTS",
  "LOGOS_CLAUDE_BARE",
  "LOGOS_CLAUDE_EFFORT",
  "LOGOS_CLAUDE_MODEL",
  "LOGOS_CLAUDE_STRICT_MCP",
  "LOGOS_CONFIG_PATH",
  "LOGOS_GOAL_NAMING",
  "LOGOS_RUNTIME_DIR",
  "LOGOS_STUDIO_RUNTIME_DIR",
  "LOGOS_STUDIO_INSTANCE_ID",
  "LOGOS_TMPDIR",
  "LOGOS_VITE_CACHE_DIR",
]

const SECRET_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
]

const PUBLIC_CLIENT_ENV_PREFIXES = [
  "VITE_",
]

function copyEnvKey(name, source, target) {
  const value = source[name]
  if (value != null) target[name] = value
}

function withPackageManagerBins(path, source) {
  const parts = path ? path.split(":").filter(Boolean) : []
  for (const key of ["PNPM_HOME", "NVM_BIN"]) {
    const value = source[key]
    if (value && !parts.includes(value)) parts.unshift(value)
  }
  const voltaHome = source["VOLTA_HOME"]
  const voltaBin = voltaHome ? `${voltaHome}/bin` : ""
  if (voltaBin && !parts.includes(voltaBin)) parts.unshift(voltaBin)
  return parts.join(":")
}

function defaultLogosRuntimeDir(sourceProject) {
  const projectRoot = resolve(sourceProject)
  const hash = createHash("sha256").update(projectRoot).digest("hex").slice(0, 12)
  const name = basename(projectRoot).replace(/[^a-zA-Z0-9._-]+/g, "-") || "project"
  return resolve(homedir(), ".logos", "projects", `${name}-${hash}`)
}

function createDevInstanceId() {
  return `dev-${Date.now().toString(36)}-${process.pid}-${randomBytes(4).toString("hex")}`
}

function sanitizePathSegment(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "instance"
}

export function isolatedDevEnv(projectRoot, source = process.env) {
  const env = {}

  for (const key of BASE_ENV_KEYS) copyEnvKey(key, source, env)
  for (const key of LOGOS_ENV_KEYS) copyEnvKey(key, source, env)
  for (const key of SECRET_ENV_KEYS) copyEnvKey(key, source, env)

  for (const [key, value] of Object.entries(source)) {
    if (value == null) continue
    if (PUBLIC_CLIENT_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      env[key] = value
    }
  }

  env.LOGOS_PROJECT = projectRoot
  env.LOGOS_STARTUP_PROJECT = projectRoot
  env.LOGOS_STUDIO_INSTANCE_ID = sanitizePathSegment(env.LOGOS_STUDIO_INSTANCE_ID ?? createDevInstanceId())
  env.LOGOS_RUNTIME_DIR = resolve(env.LOGOS_RUNTIME_DIR ?? resolve(defaultLogosRuntimeDir(projectRoot), "dev-instances", env.LOGOS_STUDIO_INSTANCE_ID))
  env.LOGOS_AGENT_RUNS_DIR = resolve(env.LOGOS_AGENT_RUNS_DIR ?? resolve(env.LOGOS_RUNTIME_DIR, "agent-runs"))
  env.LOGOS_VITE_CACHE_DIR = resolve(env.LOGOS_VITE_CACHE_DIR ?? resolve(env.LOGOS_RUNTIME_DIR, "vite-cache"))
  env.LOGOS_TMPDIR = resolve(env.LOGOS_TMPDIR ?? resolve(env.LOGOS_RUNTIME_DIR, "tmp"))
  env.PATH = withPackageManagerBins(env.PATH, source)
  mkdirSync(env.LOGOS_RUNTIME_DIR, { recursive: true })
  mkdirSync(env.LOGOS_AGENT_RUNS_DIR, { recursive: true })
  mkdirSync(env.LOGOS_VITE_CACHE_DIR, { recursive: true })
  mkdirSync(env.LOGOS_TMPDIR, { recursive: true })
  return env
}
