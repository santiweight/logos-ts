// Eval harness: fork a subject codebase, build the same context the studio uses,
// have an agent address the case comment, then run hidden checks.
//
//   pnpm exec tsx evals/run.ts
//   pnpm exec tsx evals/run.ts --quick
//   pnpm exec tsx evals/run.ts rename-company-header
//   pnpm exec tsx evals/run.ts --tier deterministic --repeat 5
//
import { execFileSync, spawn, spawnSync } from "node:child_process"
import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path"
import {
  buildArchImplementationPrompt,
  buildArchPrompt,
  buildGoalLine,
  buildStoryGenerationContext,
  buildStoryGenerationSystemPrompt,
  FRONTEND_BACKEND_SPLIT_GUIDANCE,
  isStoryGenerationRequest,
} from "../src/prompt.js"
import { buildClaudePrintArgs, cleanEnvForClaude } from "../src/claude-cli.js"

interface CommandCheck {
  cwd: string
  cmd: string[]
  oracle?: string | string[]
}

interface JudgeCheck {
  type: "judge"
  criteria?: string[]
  maxDiffChars?: number
}

type Check = CommandCheck | JudgeCheck

interface EvalCase {
  name: string
  codebase: string
  comment: {
    target: string
    targets?: string[]
    text: string
    label?: string
    component?: string
    storyId?: string
    selector?: string
    appPath?: string
    runTargetId?: string
  }
  agent: "implementation" | "architecture" | "testing" | "arch-impl"
  tier?: "deterministic" | "capability"
  repeat?: number
  timeoutMs?: number
  setup?: CommandCheck[]
  checks: Record<string, Check>
}

interface TrialResult {
  caseName: string
  tier: "deterministic" | "capability"
  agent: EvalCase["agent"]
  mode: BenchmarkMode
  trial: number
  results: Record<string, boolean>
  passedCheckCount: number
  checkCount: number
  passed: boolean
}

interface Options {
  selectors: string[]
  tier?: "deterministic" | "capability"
  repeat?: number
  concurrency: number
  quick: boolean
  dryRun: boolean
  backend: AgentBackend
  judgeBackend?: AgentBackend
  materializer: Materializer
}

const logosTsRoot = resolve(dirname(import.meta.url.replace("file://", "")), "..")
const evalsRoot = resolve(logosTsRoot, "evals")
const casesRoot = resolve(evalsRoot, "cases")
const tsx = resolve(logosTsRoot, "node_modules/.bin/tsx")
const quickCaseNames = [
  "role-sort-arch",
  "work-mode-filter-arch",
  "clickable-table-sort-headers-arch",
]
const agentBackends = ["claude-cli", "claude-cli-safe", "claude-cli-bare", "claude-sdk", "codex-cli"] as const
type AgentBackend = typeof agentBackends[number]
const materializers = ["copy", "memory"] as const
type Materializer = typeof materializers[number]
type BenchmarkMode = "implementation" | "architecture"
const defaultAgentBackend = parseAgentBackend(process.env["LOGOS_EVAL_AGENT"] ?? "claude-cli")
const defaultMaterializer = parseMaterializer(process.env["LOGOS_EVAL_MATERIALIZER"] ?? "copy")
const evalAgentModel = process.env["LOGOS_EVAL_MODEL"] ?? "sonnet"
const evalJudgeModel = process.env["LOGOS_EVAL_JUDGE_MODEL"] ?? evalAgentModel
const claudeTools = "Read,Write,Edit,MultiEdit,Bash,Glob,Grep"
const sourceSnapshots = new Map<string, SourceSnapshot>()

interface SnapshotFile {
  path: string
  data: Buffer
  mode: number
}

interface SnapshotSymlink {
  path: string
  target: string
}

interface SourceSnapshot {
  dirs: string[]
  files: SnapshotFile[]
  symlinks: SnapshotSymlink[]
}

function parseAgentBackend(value: string): AgentBackend {
  if ((agentBackends as readonly string[]).includes(value)) return value as AgentBackend
  throw new Error(`Invalid agent backend: ${value}. Expected one of: ${agentBackends.join(", ")}`)
}

function parseMaterializer(value: string): Materializer {
  if ((materializers as readonly string[]).includes(value)) return value as Materializer
  throw new Error(`Invalid materializer: ${value}. Expected one of: ${materializers.join(", ")}`)
}

function describeAgentModel(backend: AgentBackend): string {
  if (backend === "codex-cli") return process.env["LOGOS_CODEX_MODEL"] ?? "codex default"
  return evalAgentModel
}

function describeJudgeBackend(options: Pick<Options, "backend" | "judgeBackend">): AgentBackend {
  return options.judgeBackend ?? (options.backend === "codex-cli" ? "codex-cli" : "claude-cli")
}

function benchmarkMode(agent: EvalCase["agent"]): BenchmarkMode {
  return agent === "implementation" ? "implementation" : "architecture"
}

function shouldCopySourcePath(path: string): boolean {
  return !/node_modules|\.git|\.workspaces|\.logos_cache|dist|__snapshots__|evals\/cases\/runs|evals\/results/.test(path)
}

function loadSourceSnapshot(root: string): SourceSnapshot {
  const existing = sourceSnapshots.get(root)
  if (existing) return existing

  const snapshot: SourceSnapshot = { dirs: [""], files: [], symlinks: [] }
  const visit = (abs: string, rel: string) => {
    if (!shouldCopySourcePath(abs)) return
    const stat = lstatSync(abs)
    if (stat.isSymbolicLink()) {
      snapshot.symlinks.push({ path: rel, target: readlinkSync(abs) })
      return
    }
    if (stat.isDirectory()) {
      if (rel) snapshot.dirs.push(rel)
      for (const entry of readdirSync(abs)) visit(join(abs, entry), rel ? join(rel, entry) : entry)
      return
    }
    if (stat.isFile()) {
      snapshot.files.push({ path: rel, data: readFileSync(abs), mode: stat.mode })
    }
  }
  visit(root, "")
  snapshot.dirs.sort((a, b) => a.length - b.length)
  sourceSnapshots.set(root, snapshot)
  return snapshot
}

function materializeCodebase(codebase: string, work: string, materializer: Materializer): void {
  if (materializer === "copy") {
    cpSync(codebase, work, {
      recursive: true,
      filter: shouldCopySourcePath,
    })
    return
  }

  const snapshot = loadSourceSnapshot(codebase)
  for (const dir of snapshot.dirs) mkdirSync(join(work, dir), { recursive: true })
  for (const file of snapshot.files) {
    const target = join(work, file.path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, file.data, { mode: file.mode })
  }
  for (const link of snapshot.symlinks) {
    const target = join(work, link.path)
    mkdirSync(dirname(target), { recursive: true })
    symlinkSync(link.target, target)
  }
}

function buildContext(work: string, targets: string[]): string {
  try {
    return execFileSync(tsx, [resolve(logosTsRoot, "src/context.ts"), work, "40000", ...targets], {
      cwd: logosTsRoot,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    })
  } catch (e) {
    console.error("context build failed:", e)
    return ""
  }
}

function buildPrompt(c: EvalCase, work: string, context: string): string {
  const goalLine = buildGoalLine({
    label: c.comment.label ?? c.comment.target,
    text: c.comment.text,
    ...(c.comment.component ? { component: c.comment.component } : {}),
    ...(c.comment.storyId ? { storyId: c.comment.storyId } : {}),
    ...(c.comment.selector ? { selector: c.comment.selector } : {}),
    ...(c.comment.appPath ? { appPath: c.comment.appPath } : {}),
    ...(c.comment.runTargetId ? { runTargetId: c.comment.runTargetId } : {}),
  })

  const sandbox = `IMPORTANT: Your working directory is ${work}. You MUST only read and edit files under this directory using RELATIVE paths. NEVER use absolute paths, NEVER navigate to parent directories, NEVER edit files outside your working directory. All file paths in the context above are relative to your cwd.\n\n`

  const enrichedContext = isStoryGenerationRequest(c.comment.text)
    ? `${context}\n\n${buildStoryGenerationContext()}`
    : context

  if (c.agent === "architecture" || c.agent === "testing") {
    return buildArchPrompt(enrichedContext, sandbox, goalLine)
  }

  return `${enrichedContext}\n\n${sandbox}` +
    `You are an implementation agent. The ARCHITECTURE CONTEXT above already lists every file and symbol your change touches — do NOT use grep/find/ls to explore the codebase. Open a file only to read or edit an implementation body you must change.\n\n` +
    `Address these change requests:\n${goalLine}\n\n` +
    `Keep exported signatures stable unless a change requires otherwise; reuse existing helpers; make it typecheck.` +
    ` ${FRONTEND_BACKEND_SPLIT_GUIDANCE}` +
    ` For TypeScript node:test suites, prefer \`node --import tsx --test <test-file>\`; if \`pnpm test\` or \`pnpm exec tsx --test\` fails with \`listen EPERM\`, rerun the same tests with \`node --import tsx --test\`.` +
    ` This project has no automated test runner configured. Verify your changes manually.`
}

async function runAgent(
  prompt: string,
  opts: { cwd: string; timeout: number; backend: AgentBackend; extraArgs?: string[] },
): Promise<void> {
  switch (opts.backend) {
    case "claude-cli":
      return runClaudeCli(prompt, opts)
    case "claude-cli-safe":
      return runClaudeCli(prompt, opts, ["--safe-mode"])
    case "claude-cli-bare":
      return runClaudeCli(prompt, opts, ["--bare", "--no-session-persistence", "--tools", "default", "--allowedTools", claudeTools])
    case "claude-sdk":
      return runClaudeSdk(prompt, opts)
    case "codex-cli":
      return runCodexCli(prompt, opts)
  }
}

function runClaudeCli(
  prompt: string,
  opts: { cwd: string; timeout: number; extraArgs?: string[] },
  modeArgs: string[] = [],
): Promise<void> {
  const args = modeArgs.length === 0
    ? buildClaudePrintArgs({
      promptArg: "-",
      model: evalAgentModel,
      noSessionPersistence: true,
      ...(opts.extraArgs ? { extraArgs: opts.extraArgs } : {}),
    })
    : [
      ...modeArgs,
      "-p",
      "-",
      "--model",
      evalAgentModel,
      "--permission-mode",
      "bypassPermissions",
      "--dangerously-skip-permissions",
      ...(opts.extraArgs ?? []),
    ]
  return spawnAgentCommand("claude", args, {
    cwd: opts.cwd,
    input: prompt,
    timeout: opts.timeout,
    label: "claude",
    env: cleanEnvForClaude(),
  })
}

async function runClaudeSdk(
  prompt: string,
  opts: { cwd: string; timeout: number; extraArgs?: string[] },
): Promise<void> {
  const sdk = await import("@anthropic-ai/claude-agent-sdk")
  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), opts.timeout)
  const appendSystemPrompt = appendedSystemPrompt(opts.extraArgs ?? [])
  const effectivePrompt = appendSystemPrompt ? `${appendSystemPrompt}\n\n${prompt}` : prompt

  try {
    const query = sdk.query({
      prompt: effectivePrompt,
      options: {
        cwd: opts.cwd,
        model: evalAgentModel,
        abortController,
        tools: { type: "preset", preset: "claude_code" },
        allowedTools: claudeTools.split(","),
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        settingSources: [],
        persistSession: false,
      },
    })

    for await (const message of query) {
      process.stdout.write(`${JSON.stringify(message)}\n`)
    }
  } catch (error) {
    if (abortController.signal.aborted) throw new Error(`claude-sdk timed out after ${opts.timeout}ms`)
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

function runCodexCli(
  prompt: string,
  opts: { cwd: string; timeout: number; extraArgs?: string[] },
): Promise<void> {
  const appendSystemPrompt = appendedSystemPrompt(opts.extraArgs ?? [])
  const effectivePrompt = appendSystemPrompt ? `${appendSystemPrompt}\n\n${prompt}` : prompt
  const args = [
    "exec",
    "-",
    "--cd",
    opts.cwd,
    "--sandbox",
    process.env["LOGOS_CODEX_SANDBOX"] ?? "workspace-write",
    "--skip-git-repo-check",
  ]
  if (process.env["LOGOS_CODEX_MODEL"]) args.push("--model", process.env["LOGOS_CODEX_MODEL"])
  if (process.env["LOGOS_CODEX_YOLO"] === "1") args.push("--dangerously-bypass-approvals-and-sandbox")
  if (process.env["LOGOS_CODEX_JSON"] === "1") args.push("--json")

  const command = commandExists("codex") ? "codex" : "pnpm"
  const effectiveArgs = command === "codex" ? args : ["dlx", "@openai/codex", ...args]
  return spawnAgentCommand(command, effectiveArgs, {
    cwd: opts.cwd,
    input: effectivePrompt,
    timeout: opts.timeout,
    label: "codex",
  })
}

function spawnAgentCommand(
  command: string,
  args: string[],
  opts: { cwd: string; input: string; timeout: number; label: string; env?: NodeJS.ProcessEnv },
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      stdio: ["pipe", "inherit", "inherit"],
      ...(opts.env ? { env: opts.env } : {}),
    })
    let settled = false
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      child.kill("SIGTERM")
      setTimeout(() => {
        if (!settled) child.kill("SIGKILL")
      }, 5_000).unref()
    }, opts.timeout)

    child.on("error", (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(error)
    })

    child.on("close", (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (timedOut) {
        reject(new Error(`${opts.label} timed out after ${opts.timeout}ms`))
        return
      }
      if (code === 0) {
        resolvePromise()
        return
      }
      reject(new Error(`${opts.label} exited with code ${code ?? `signal ${signal}`}`))
    })

    child.stdin.end(opts.input)
  })
}

function commandExists(command: string): boolean {
  const result = spawnSync("sh", ["-lc", `command -v ${command}`], {
    stdio: ["ignore", "ignore", "ignore"],
  })
  return result.status === 0
}

function appendedSystemPrompt(args: string[]): string {
  const chunks: string[] = []
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === "--append-system-prompt") {
      const value = args[i + 1]
      if (value) chunks.push(value)
      i += 1
    }
  }
  return chunks.join("\n\n")
}

function computeDiff(original: string, modified: string): string {
  try {
    return execFileSync("diff", [
      "-ruN",
      "--exclude=node_modules",
      "--exclude=.next",
      "--exclude=.logos",
      "--exclude=.storybook",
      "--exclude=*.tsbuildinfo",
      original,
      modified,
    ], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 })
  } catch (e: any) {
    const raw: string = e.stdout ?? ""
    const lines = raw.split("\n")
    return lines.length > 500 ? lines.slice(0, 500).join("\n") + "\n[diff truncated]" : raw
  }
}

function isJudgeCheck(check: Check): check is JudgeCheck {
  return "type" in check && check.type === "judge"
}

function truncateMiddle(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  const headChars = Math.floor(maxChars * 0.6)
  const tailChars = Math.max(0, maxChars - headChars)
  return `${value.slice(0, headChars)}\n[diff truncated]\n${value.slice(value.length - tailChars)}`
}

function extractJsonObject(value: string): Record<string, unknown> {
  const direct = value.trim()
  const candidates = [
    direct,
    direct.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, ""),
  ]

  const start = direct.indexOf("{")
  const end = direct.lastIndexOf("}")
  if (start >= 0 && end > start) candidates.push(direct.slice(start, end + 1))

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error(`judge did not return a JSON object: ${value.slice(0, 500)}`)
}

function buildJudgePrompt(c: EvalCase, diff: string, check: JudgeCheck): string {
  const criteria = check.criteria?.length
    ? check.criteria
    : [
      "The diff addresses the requested behavior in a plausible, maintainable way.",
      "The diff keeps implementation scope focused and avoids broad unrelated rewrites.",
      "Substantive data behavior belongs in backend/domain/data modules or server-side helpers; UI code should only wire inputs/results and handle presentation.",
      "Any tests added or changed are relevant to the requested behavior.",
      "The diff does not obviously introduce broken imports, invalid syntax, or dead code.",
    ]

  return [
    "You are judging an eval candidate by reading only the user's requested change and the unified diff produced by the agent.",
    "Return strict JSON only, with this shape:",
    `{"pass": boolean, "score": number, "issues": string[], "summary": string}`,
    "Use score 0-100. Set pass=true only when the diff is generally sane and satisfies every must-have criterion.",
    "",
    "User request:",
    c.comment.text,
    "",
    "Criteria:",
    ...criteria.map((criterion) => `- ${criterion}`),
    "",
    "Unified diff:",
    "```diff",
    diff || "[no diff]",
    "```",
  ].join("\n")
}

function runClaudeJudge(prompt: string): string {
  const args = buildClaudePrintArgs({
    promptArg: "-",
    model: evalJudgeModel,
    outputFormat: "text",
    noSessionPersistence: true,
  })
  const output = execFileSync("claude", args, {
    cwd: logosTsRoot,
    input: prompt,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    env: cleanEnvForClaude(),
  })
  return output
}

function runCodexJudge(prompt: string): string {
  const args = [
    "exec",
    "-",
    "--cd",
    logosTsRoot,
    "--sandbox",
    "read-only",
    "--skip-git-repo-check",
  ]
  if (process.env["LOGOS_CODEX_MODEL"]) args.push("--model", process.env["LOGOS_CODEX_MODEL"])

  const command = commandExists("codex") ? "codex" : "pnpm"
  const effectiveArgs = command === "codex" ? args : ["dlx", "@openai/codex", ...args]
  return execFileSync(command, effectiveArgs, {
    cwd: logosTsRoot,
    input: prompt,
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  })
}

function runJudgeCheck(c: EvalCase, check: JudgeCheck, diff: string, backend: AgentBackend): boolean {
  const maxDiffChars = check.maxDiffChars ?? 80_000
  const prompt = buildJudgePrompt(c, truncateMiddle(diff, maxDiffChars), check)
  const output = backend === "codex-cli" ? runCodexJudge(prompt) : runClaudeJudge(prompt)
  const parsed = extractJsonObject(output)
  const passed = parsed["pass"] === true
  const score = typeof parsed["score"] === "number" ? parsed["score"] : "unknown"
  const summary = typeof parsed["summary"] === "string" ? parsed["summary"] : ""
  const issues = Array.isArray(parsed["issues"]) ? parsed["issues"].filter((issue) => typeof issue === "string") : []

  console.log(`[${c.name}] judge score: ${score}; pass=${passed}${summary ? `; ${summary}` : ""}`)
  for (const issue of issues.slice(0, 5)) console.log(`[${c.name}] judge issue: ${issue}`)
  return passed
}

function buildArchImplPrompt(c: EvalCase, work: string, context: string): string {
  const goalLine = buildGoalLine({
    label: c.comment.label ?? c.comment.target,
    text: c.comment.text,
    ...(c.comment.component ? { component: c.comment.component } : {}),
    ...(c.comment.storyId ? { storyId: c.comment.storyId } : {}),
    ...(c.comment.selector ? { selector: c.comment.selector } : {}),
    ...(c.comment.appPath ? { appPath: c.comment.appPath } : {}),
    ...(c.comment.runTargetId ? { runTargetId: c.comment.runTargetId } : {}),
  })
  const sandbox = `IMPORTANT: Your working directory is ${work}. You MUST only read and edit files under this directory using RELATIVE paths. NEVER use absolute paths, NEVER navigate to parent directories, NEVER edit files outside your working directory. All file paths in the context above are relative to your cwd.\n\n`
  return buildArchImplementationPrompt(
    context,
    sandbox,
    goalLine,
    "This eval harness has no live test-runner MCP. Run the relevant project test/typecheck commands yourself and iterate until they pass. For TypeScript node:test suites, prefer `node --import tsx --test <test-file>`; if `pnpm test` or `pnpm exec tsx --test` fails with `listen EPERM`, rerun the same tests with `node --import tsx --test`.",
  )
}

function buildImplPrompt(
  context: string,
  work: string,
  goalLine: string,
  archDiff: string,
  archSummary: string,
): string {
  const sandbox = `IMPORTANT: Your working directory is ${work}. You MUST only read and edit files under this directory using RELATIVE paths. NEVER use absolute paths, NEVER navigate to parent directories, NEVER edit files outside your working directory. All file paths in the context above are relative to your cwd.\n\n`

  return `${context}\n\n` +
    `# ARCHITECTURE CHANGE — what the architect decided\n\n` +
    `${archSummary}\n\n` +
    `## Architecture diff:\n\`\`\`diff\n${archDiff}\n\`\`\`\n\n` +
    `${sandbox}` +
    `You are an implementation agent. The codebase has been partially updated by an architecture agent — it contains \`declare\` stubs where you must write the actual function bodies, and test stubs with \`throw new Error("not implemented")\` where you must write the actual test logic.\n\n` +
    `Address these change requests:\n${goalLine}\n\n` +
    `Fill in all \`declare\` function bodies and test stubs. Wire the new helpers into the existing code as the architecture indicates. Make sure existing tests still pass.`
}

function copyOracles(caseDir: string, check: CommandCheck, checkCwd: string): void {
  const oracles = typeof check.oracle === "string" ? [check.oracle] : check.oracle ?? []
  for (const oracle of oracles) {
    copyFileSync(resolve(caseDir, oracle), join(checkCwd, basename(oracle)))
  }
}

function resolveCheckCwd(work: string, check: CommandCheck): string {
  const checkCwd = join(work, check.cwd)
  if (existsSync(checkCwd)) return checkCwd

  // Older eval definitions pointed at a frontend/ subdir. The HN Jobs fixture is
  // now rooted at the Next app, so keep those evals runnable without rewriting
  // every historical case file.
  if (check.cwd === "frontend" && existsSync(join(work, "package.json"))) return work
  return checkCwd
}

async function runCase(casePath: string, trial: number, options: Pick<Options, "backend" | "materializer">): Promise<TrialResult> {
  const caseDir = dirname(resolve(casePath))
  const c: EvalCase = JSON.parse(readFileSync(resolve(casePath), "utf8"))
  const codebase = resolve(caseDir, c.codebase)
  const caseRel = relative(codebase, caseDir)
  const caseInsideCodebase = caseRel === "" || (!caseRel.startsWith("..") && !isAbsolute(caseRel))
  const runDir = caseInsideCodebase
    ? resolve(codebase, "..", ".eval-runs", c.name, `t${trial}`)
    : resolve(caseDir, "runs", c.name, `t${trial}`)
  const work = resolve(runDir, "work")
  const tier = c.tier ?? "capability"

  console.log(`[${c.name} t${trial}] forking codebase...`)
  rmSync(runDir, { recursive: true, force: true })
  mkdirSync(work, { recursive: true })
  materializeCodebase(codebase, work, options.materializer)
  for (const rel of ["node_modules", "frontend/node_modules"]) {
    const src = join(codebase, rel)
    if (existsSync(src) && !existsSync(join(work, rel))) symlinkSync(src, join(work, rel))
  }

  if (c.setup?.length) {
    console.log(`[${c.name} t${trial}] running setup...`)
    for (const setup of c.setup) {
      const setupCwd = join(work, setup.cwd)
      copyOracles(caseDir, setup, setupCwd)
      const [cmd, ...args] = setup.cmd
      if (!cmd) throw new Error(`setup command missing for ${c.name}`)
      execFileSync(cmd, args, { cwd: setupCwd, encoding: "utf8" })
    }
  }

  const archMode = c.agent === "architecture" || c.agent === "testing" || c.agent === "arch-impl"
  const bodiesFile = resolve(runDir, "bodies.json")
  const originalSnapshot = resolve(runDir, "original")
  cpSync(work, originalSnapshot, {
    recursive: true,
    filter: (s) => !/node_modules/.test(s),
  })
  if (archMode) {
    console.log(`[${c.name} t${trial}] stripping to architecture view...`)
    execFileSync(tsx, [resolve(logosTsRoot, "src/archmode.ts"), "strip", work, bodiesFile], {
      cwd: logosTsRoot,
      encoding: "utf8",
    })
  }

  console.log(`[${c.name} t${trial}] building context...`)
  const targets = c.comment.targets?.length
    ? c.comment.targets
    : [c.comment.component ? `component:${c.comment.component}` : c.comment.target]
  const context = buildContext(work, targets)
  console.log(`[${c.name} t${trial}] context: ${context.length} chars`)

  const prompt = buildPrompt(c, work, context)
  const storyArgs = isStoryGenerationRequest(c.comment.text)
    ? ["--append-system-prompt", buildStoryGenerationSystemPrompt()]
    : []
  console.log(`[${c.name} t${trial}] running agent (${c.agent} mode)...`)
  try {
    await runAgent(prompt, {
      cwd: work,
      timeout: c.timeoutMs ?? (archMode ? 600_000 : 300_000),
      backend: options.backend,
      extraArgs: storyArgs,
    })
  } catch (e: any) {
    console.error(`[${c.name} t${trial}] agent failed:`, e.message)
  }

  if (archMode) {
    console.log(`[${c.name} t${trial}] splicing implementations + inferring imports...`)
    execFileSync(tsx, [resolve(logosTsRoot, "src/archmode.ts"), "splice", work, bodiesFile], {
      cwd: logosTsRoot,
      encoding: "utf8",
    })
  }

  if (c.agent === "architecture" || c.agent === "testing") {
    console.log(`[${c.name} t${trial}] rebuilding implementation context...`)
    const implContext = buildContext(work, targets)
    const implPrompt = buildArchImplPrompt(c, work, implContext)
    console.log(`[${c.name} t${trial}] running implementation pass after architecture...`)
    try {
      await runAgent(implPrompt, {
        cwd: work,
        timeout: c.timeoutMs ?? 600_000,
        backend: options.backend,
        extraArgs: isStoryGenerationRequest(c.comment.text)
          ? ["--append-system-prompt", buildStoryGenerationSystemPrompt()]
          : [],
      })
    } catch (e: any) {
      console.error(`[${c.name} t${trial}] implementation pass failed:`, e.message)
    }
  }

  if (c.agent === "arch-impl") {
    const archDiff = computeDiff(originalSnapshot, work)
    console.log(`[${c.name} t${trial}] arch diff: ${archDiff.length} chars`)

    console.log(`[${c.name} t${trial}] rebuilding context for impl agent...`)
    const implContext = buildContext(work, targets)
    console.log(`[${c.name} t${trial}] impl context: ${implContext.length} chars`)

    const goalLine = buildGoalLine({
      label: c.comment.label ?? c.comment.target,
      text: c.comment.text,
      ...(c.comment.component ? { component: c.comment.component } : {}),
      ...(c.comment.storyId ? { storyId: c.comment.storyId } : {}),
      ...(c.comment.selector ? { selector: c.comment.selector } : {}),
      ...(c.comment.appPath ? { appPath: c.comment.appPath } : {}),
      ...(c.comment.runTargetId ? { runTargetId: c.comment.runTargetId } : {}),
    })

    const implPrompt = buildImplPrompt(implContext, work, goalLine, archDiff, c.comment.text)
    console.log(`[${c.name} t${trial}] running impl agent...`)
    try {
      await runAgent(implPrompt, { cwd: work, timeout: c.timeoutMs ?? 300_000, backend: options.backend })
    } catch (e: any) {
      console.error(`[${c.name} t${trial}] impl agent failed:`, e.message)
    }
  }

  const finalDiff = computeDiff(originalSnapshot, work)
  console.log(`[${c.name} t${trial}] final diff: ${finalDiff.length} chars`)

  console.log(`[${c.name} t${trial}] running checks...`)
  const results: Record<string, boolean> = {}
  for (const [name, check] of Object.entries(c.checks)) {
    if (isJudgeCheck(check)) {
      try {
        results[name] = runJudgeCheck(c, check, finalDiff, describeJudgeBackend(options))
      } catch (e: any) {
        console.error(`[${c.name} t${trial}] judge failed (${name}):`, e.message)
        results[name] = false
      }
      continue
    }

    const checkCwd = resolveCheckCwd(work, check)
    const [cmd, ...args] = check.cmd
    if (!cmd) {
      results[name] = false
      continue
    }
    try {
      copyOracles(caseDir, check, checkCwd)
      execFileSync(cmd, args, {
        cwd: checkCwd,
        encoding: "utf8",
        env: {
          ...process.env,
          CI: process.env["CI"] ?? "true",
          npm_config_verify_deps_before_run: "false",
          PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: "false",
        },
      })
      results[name] = true
    } catch (e: any) {
      console.error(`[${c.name} t${trial}] check failed (${name}):`, e.message)
      results[name] = false
    }
  }

  const passed = Object.values(results).every(Boolean)
  const checkValues = Object.values(results)
  const passedCheckCount = checkValues.filter(Boolean).length
  const checkCount = checkValues.length
  console.log(`[${c.name} t${trial}] results:`, results)
  return {
    caseName: c.name,
    tier,
    agent: c.agent,
    mode: benchmarkMode(c.agent),
    trial,
    results,
    passedCheckCount,
    checkCount,
    passed,
  }
}

function parseArgs(argv: string[]): Options {
  const selectors: string[] = []
  let tier: Options["tier"]
  let repeat: number | undefined
  let concurrency = 1
  let quick = false
  let dryRun = false
  let backend = defaultAgentBackend
  let judgeBackend: AgentBackend | undefined = process.env["LOGOS_EVAL_JUDGE_BACKEND"]
    ? parseAgentBackend(process.env["LOGOS_EVAL_JUDGE_BACKEND"])
    : undefined
  let materializer = defaultMaterializer

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === "--tier") {
      const value = argv[++i]
      if (value !== "deterministic" && value !== "capability") throw new Error(`Invalid --tier: ${value}`)
      tier = value
    } else if (arg === "--repeat") {
      repeat = Number(argv[++i])
      if (!Number.isInteger(repeat) || repeat < 1) throw new Error("--repeat must be a positive integer")
    } else if (arg === "--concurrency") {
      concurrency = Number(argv[++i])
      if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("--concurrency must be a positive integer")
    } else if (arg === "--quick") {
      quick = true
    } else if (arg === "--dry-run") {
      dryRun = true
    } else if (arg === "--backend") {
      backend = parseAgentBackend(argv[++i] ?? "")
    } else if (arg === "--judge-backend") {
      judgeBackend = parseAgentBackend(argv[++i] ?? "")
    } else if (arg === "--materializer") {
      materializer = parseMaterializer(argv[++i] ?? "")
    } else if (arg?.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`)
    } else if (arg) {
      selectors.push(arg)
    }
  }

  return {
    selectors,
    concurrency,
    quick,
    dryRun,
    backend,
    ...(judgeBackend ? { judgeBackend } : {}),
    materializer,
    ...(tier ? { tier } : {}),
    ...(repeat ? { repeat } : {}),
  }
}

function collectCasePaths(dir: string, includeSubdirs: boolean): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && ["runs", "node_modules"].includes(entry.name)) continue
    const path = resolve(dir, entry.name)
    if (entry.isDirectory() && includeSubdirs && entry.name !== "runs") out.push(...collectCasePaths(path, includeSubdirs))
    else if (entry.isFile() && extname(entry.name) === ".json") out.push(path)
  }
  return out.sort()
}

function selectCases(options: Options): string[] {
  const topLevel = collectCasePaths(casesRoot, false)
  const all = collectCasePaths(casesRoot, true)
  const byName = new Map<string, string>()
  for (const path of all) {
    const c: EvalCase = JSON.parse(readFileSync(path, "utf8"))
    byName.set(c.name, path)
  }

  const selectors = options.quick && options.selectors.length === 0
    ? quickCaseNames
    : options.selectors

  const selected = selectors.length === 0
    ? topLevel
    : selectors.map((selector) => {
      const direct = resolve(logosTsRoot, selector)
      if (existsSync(direct)) return direct
      const byCaseName = byName.get(selector)
      if (byCaseName) return byCaseName
      throw new Error(`Unknown eval case: ${selector}`)
    })

  return selected.filter((path) => {
    if (!options.tier) return true
    const c: EvalCase = JSON.parse(readFileSync(path, "utf8"))
    return (c.tier ?? "capability") === options.tier
  })
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next]
      next += 1
      if (item) await fn(item)
    }
  })
  await Promise.all(workers)
}

interface BenchmarkBucket {
  passed: number
  total: number
}

function addBucketCheck(bucket: BenchmarkBucket, result: TrialResult): void {
  bucket.passed += result.passedCheckCount
  bucket.total += result.checkCount
}

function formatRate(bucket: BenchmarkBucket): string {
  const percentage = bucket.total === 0 ? 0 : (bucket.passed / bucket.total) * 100
  return `${bucket.passed}/${bucket.total} (${percentage.toFixed(1)}%)`
}

function printBenchmarkSummary(results: TrialResult[]): void {
  const buckets: Record<BenchmarkMode | "overall", BenchmarkBucket> = {
    architecture: { passed: 0, total: 0 },
    implementation: { passed: 0, total: 0 },
    overall: { passed: 0, total: 0 },
  }

  for (const result of results) {
    addBucketCheck(buckets[result.mode], result)
    addBucketCheck(buckets.overall, result)
  }

  console.log("\nBenchmark summary (hidden-check pass rate)")
  console.log(`architecture: ${formatRate(buckets.architecture)}`)
  console.log(`implementation: ${formatRate(buckets.implementation)}`)
  console.log(`overall: ${formatRate(buckets.overall)}`)
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  console.log(`Agent backend: ${options.backend} (model: ${describeAgentModel(options.backend)})`)
  console.log(`Judge backend: ${describeJudgeBackend(options)} (model: ${describeAgentModel(describeJudgeBackend(options))})`)
  console.log(`Materializer: ${options.materializer}`)
  const casePaths = selectCases(options)
  if (casePaths.length === 0) {
    console.log("No eval cases matched.")
    return
  }

  const trials: Array<{ casePath: string; trial: number }> = []
  for (const casePath of casePaths) {
    const c: EvalCase = JSON.parse(readFileSync(casePath, "utf8"))
    const repeat = options.repeat ?? (options.quick ? 1 : c.repeat ?? 1)
    for (let trial = 1; trial <= repeat; trial += 1) trials.push({ casePath, trial })
  }

  if (options.dryRun) {
    console.log(`Selected ${casePaths.length} case(s), ${trials.length} trial(s):`)
    for (const casePath of casePaths) {
      const c: EvalCase = JSON.parse(readFileSync(casePath, "utf8"))
      const trialCount = trials.filter((trial) => trial.casePath === casePath).length
      console.log(`- ${c.name} (${c.tier ?? "capability"}, ${trialCount} trial${trialCount === 1 ? "" : "s"})`)
    }
    return
  }

  const startedAt = new Date().toISOString()
  const results: TrialResult[] = []
  await runWithConcurrency(trials, options.concurrency, async ({ casePath, trial }) => {
    results.push(await runCase(casePath, trial, options))
  })

  const summary = {
    startedAt,
    finishedAt: new Date().toISOString(),
    options,
    results: results.sort((a, b) => a.caseName.localeCompare(b.caseName) || a.trial - b.trial),
  }

  const resultsDir = resolve(evalsRoot, "results")
  mkdirSync(resultsDir, { recursive: true })
  const resultsFile = resolve(resultsDir, `${startedAt.replace(/[:.]/g, "-")}.json`)
  writeFileSync(resultsFile, `${JSON.stringify(summary, null, 2)}\n`)

  console.log("\nEval summary")
  for (const caseName of Array.from(new Set(summary.results.map((r) => r.caseName))).sort()) {
    const caseResults = summary.results.filter((r) => r.caseName === caseName)
    const passed = caseResults.filter((r) => r.passed).length
    console.log(`${caseName}: ${passed}/${caseResults.length}`)
  }
  printBenchmarkSummary(summary.results)
  console.log(`Results written to ${resultsFile}`)

  const failedGate = summary.results.some((result) => result.tier === "deterministic" && !result.passed)
  if (failedGate) process.exitCode = 1
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e))
  process.exitCode = 1
})
