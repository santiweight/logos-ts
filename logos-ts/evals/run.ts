// Eval harness: given cases (codebase + comment + checks), fork the codebase,
// run the same agent pipeline the studio runs, then run checks and report.
//
//   npx tsx evals/run.ts                                # all cases, once each
//   npx tsx evals/run.ts bold-role-element              # one case by name
//   npx tsx evals/run.ts --tier deterministic --repeat 5
//   npx tsx evals/run.ts --model haiku bold-role-element
//   npx tsx evals/run.ts evals/cases/fuzzy-search-arch.json
//
// Tiers:
//   deterministic — small, unambiguous tweaks. Expected to pass on EVERY
//                   trial; any failure fails the run (exit 1).
//   capability    — large changes (architecture mode etc.). Pass rate is
//                   reported but does not gate the exit code.
//
// Architecture cases run the real production pipeline: archmode strip →
// architecture agent over `declare` signatures → archmode splice → an
// implementation agent that fills in new stubs and satisfies the goal.
import { execFile, spawn } from "node:child_process"
import { promisify } from "node:util"
import {
  cpSync, rmSync, mkdirSync, existsSync, readFileSync, writeFileSync,
  symlinkSync, copyFileSync, readdirSync, createWriteStream, appendFileSync,
} from "node:fs"
import { resolve, dirname, basename, join, relative } from "node:path"
import { buildGoalLine, buildArchPrompt, buildImplPrompt, buildVerifyNote } from "../src/prompt.js"
import { detectProject } from "../src/detect-project.js"

const execFileAsync = promisify(execFile)

interface Check {
  cwd: string
  cmd: string[]
  oracle?: string | string[]
}
interface EvalCase {
  name: string
  codebase: string
  comment: { target: string; text: string; label?: string; component?: string; storyId?: string; selector?: string }
  agent: "implementation" | "architecture" | "testing"
  tier?: "deterministic" | "capability"
  model?: string
  repeat?: number
  timeoutMs?: number
  skipTestRunner?: boolean
  contextBudget?: number
  checks: Record<string, Check>
}
interface AgentTestRuns {
  runs: number
  passed: number
  failed: number
  error: number
  finalStatus: string | null
}
interface TrialResult {
  trial: number
  agentOk: boolean
  agentNote?: string
  agentTestRuns?: AgentTestRuns
  checks: Record<string, boolean>
  pass: boolean
  durationMs: number
}
interface CaseResult {
  name: string
  tier: "deterministic" | "capability"
  agent: EvalCase["agent"]
  model: string
  trials: TrialResult[]
}

const logosTsRoot = resolve(dirname(import.meta.url.replace("file://", "")), "..")
const casesDir = resolve(logosTsRoot, "evals/cases")
const resultsDir = resolve(logosTsRoot, "evals/results")
const tsx = resolve(logosTsRoot, "node_modules/.bin/tsx")

const DEFAULT_TIMEOUT = { implementation: 300_000, architecture: 600_000, testing: 600_000 }
const CHECK_TIMEOUT = 240_000

// ---- fork ----

function fork(codebase: string, work: string) {
  mkdirSync(work, { recursive: true })
  cpSync(codebase, work, {
    recursive: true,
    filter: (s) => !/node_modules|\.workspaces|\.logos_cache|dist|__snapshots__/.test(s),
  })
  const deps = join(codebase, "frontend/node_modules")
  if (existsSync(deps)) {
    symlinkSync(deps, join(work, "frontend/node_modules"))
    symlinkSync(deps, join(work, "node_modules"))
  }
}

// ---- pipeline pieces ----

async function buildContext(work: string, targets: string[], log: (m: string) => void, budget = 40000): Promise<string> {
  try {
    const { stdout } = await execFileAsync(tsx, [resolve(logosTsRoot, "src/context.ts"), work, String(budget), ...targets], {
      cwd: logosTsRoot, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
    })
    return stdout
  } catch (e) {
    log(`context build failed: ${String(e)}`)
    return ""
  }
}

async function archmode(cmd: "strip" | "splice", work: string, bodiesFile: string, log: (m: string) => void): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(tsx, [resolve(logosTsRoot, "src/archmode.ts"), cmd, work, bodiesFile], {
      cwd: logosTsRoot, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
    })
    log(`archmode ${cmd}: ${stdout.trim()}`)
    return true
  } catch (e) {
    log(`archmode ${cmd} failed: ${String(e)}`)
    return false
  }
}

function runAgent(prompt: string, cwd: string, timeoutMs: number, logPath: string, mcpConfigPath: string, model: string): Promise<{ ok: boolean; note?: string }> {
  return new Promise((res) => {
    const out = createWriteStream(logPath, { flags: "a" })
    const child = spawn("claude", ["-p", prompt, "--model", model, "--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions", "--mcp-config", mcpConfigPath], {
      cwd, stdio: ["ignore", "pipe", "pipe"],
    })
    child.stdout.pipe(out)
    child.stderr.pipe(out)
    let timedOut = false
    const t = setTimeout(() => { timedOut = true; child.kill("SIGKILL") }, timeoutMs)
    child.on("error", (e) => { clearTimeout(t); res({ ok: false, note: String(e) }) })
    child.on("close", (code) => {
      clearTimeout(t)
      if (timedOut) res({ ok: false, note: `timeout after ${timeoutMs / 1000}s` })
      else if (code === 0) res({ ok: true })
      else res({ ok: false, note: `exit ${code}` })
    })
  })
}

// Files left with bodyless `declare` statements after splice — i.e. signatures
// the architecture agent added that nobody has implemented yet.
function findDeclareStubs(work: string): string[] {
  const hits: string[] = []
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".") || e.isSymbolicLink()) continue
      const p = join(d, e.name)
      if (e.isDirectory()) { walk(p); continue }
      if (!/\.(ts|tsx)$/.test(e.name) || /\.test\.[cm]?tsx?$/.test(e.name)) continue
      if (/^(export )?declare (async )?(function|const|let|class)\b/m.test(readFileSync(p, "utf8")))
        hits.push(relative(work, p))
    }
  }
  walk(work)
  return hits
}

// Same MCP setup the studio gives production agents: a test-runner server
// that auto-runs the project's suite on file save and records every run.
function writeMcpConfig(slot: string, work: string, tests: { command: string[]; watchDirs: string[] } | null): string {
  const mcpConfig: { mcpServers: Record<string, unknown> } = { mcpServers: {} }
  if (tests) {
    mcpConfig.mcpServers["test-runner"] = {
      command: tsx,
      args: [resolve(logosTsRoot, "src/test-runner-mcp.ts"), JSON.stringify({
        cwd: work,
        command: tests.command,
        watch: tests.watchDirs,
        filePattern: "\\.(tsx?|jsx?)$",
      })],
    }
  }
  const path = join(slot, "mcp.json")
  writeFileSync(path, JSON.stringify(mcpConfig))
  return path
}

// Aggregate the test runs the agent triggered (recorded by test-runner-mcp
// in runs.jsonl) so the harness can report them per trial.
function readAgentTestRuns(work: string): AgentTestRuns | undefined {
  const path = join(work, ".logos_cache", "test-runner-mcp", "runs.jsonl")
  if (!existsSync(path)) return undefined
  const runs = readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => {
    try { return JSON.parse(l) as { status: string } } catch { return null }
  }).filter((r): r is { status: string } => r !== null)
  if (!runs.length) return undefined
  return {
    runs: runs.length,
    passed: runs.filter((r) => r.status === "passed").length,
    failed: runs.filter((r) => r.status === "failed").length,
    error: runs.filter((r) => r.status === "error").length,
    finalStatus: runs[runs.length - 1]!.status,
  }
}

const sandboxNote = (work: string) =>
  `IMPORTANT: Your working directory is ${work}. You MUST only read and edit files under this directory using RELATIVE paths. NEVER use absolute paths, NEVER navigate to parent directories, NEVER edit files outside your working directory. All file paths in the context above are relative to your cwd.\n\n`

// ---- checks ----

async function runChecks(c: EvalCase, caseDir: string, work: string, log: (m: string) => void): Promise<Record<string, boolean>> {
  const results: Record<string, boolean> = {}
  for (const [name, check] of Object.entries(c.checks)) {
    const oracles = check.oracle == null ? [] : Array.isArray(check.oracle) ? check.oracle : [check.oracle]
    for (const o of oracles) copyFileSync(resolve(caseDir, o), join(work, check.cwd, basename(o)))
    try {
      const { stdout, stderr } = await execFileAsync(check.cmd[0]!, check.cmd.slice(1), {
        cwd: join(work, check.cwd), encoding: "utf8", timeout: CHECK_TIMEOUT, maxBuffer: 16 * 1024 * 1024,
      })
      log(`check ${name}: PASS\n${stdout}${stderr}`)
      results[name] = true
    } catch (e: any) {
      log(`check ${name}: FAIL\n${e.stdout ?? ""}${e.stderr ?? ""}${e.stdout || e.stderr ? "" : String(e)}`)
      results[name] = false
    }
  }
  return results
}

// ---- trial ----

async function runTrial(c: EvalCase, caseDir: string, trial: number, modelOverride?: string): Promise<TrialResult> {
  const started = Date.now()
  const slot = resolve(caseDir, "runs", c.name, `t${trial}`)
  const work = join(slot, "work")
  const logPath = join(slot, "trial.log")
  rmSync(slot, { recursive: true, force: true })
  mkdirSync(slot, { recursive: true })
  const log = (m: string) => appendFileSync(logPath, `[${new Date().toISOString()}] ${m}\n`)
  const say = (m: string) => { console.log(`[${c.name} t${trial}] ${m}`); log(m) }

  say("forking codebase…")
  fork(resolve(caseDir, c.codebase), work)

  const targets = [c.comment.component ? `component:${c.comment.component}` : c.comment.target]
  const goalLine = buildGoalLine({
    label: c.comment.label ?? c.comment.target,
    text: c.comment.text,
    component: c.comment.component ?? null,
    storyId: c.comment.storyId ?? null,
    selector: c.comment.selector ?? null,
  })
  const timeoutMs = c.timeoutMs ?? DEFAULT_TIMEOUT[c.agent]
  const agentLog = join(slot, "agent.log")
  const model = modelOverride ?? c.model ?? "sonnet"
  const caps = detectProject(work)
  const tests = c.skipTestRunner ? null : caps.tests
  const mcpConfigPath = writeMcpConfig(slot, work, tests)
  const verifyNote = buildVerifyNote(!!tests)

  let agentOk = true
  let agentNote: string | undefined

  if (c.agent === "architecture" || c.agent === "testing") {
    // Phase 1: real arch pipeline — strip, agent over signatures, splice.
    const bodiesFile = join(slot, "bodies.json")
    say("stripping to architecture view…")
    await archmode("strip", work, bodiesFile, log)
    say("building context…")
    const archContext = await buildContext(work, targets, log, c.contextBudget)
    say(`context: ${archContext.length} chars; running architecture agent…`)
    const a1 = await runAgent(buildArchPrompt(archContext, sandboxNote(work), goalLine), work, timeoutMs, agentLog, mcpConfigPath, model)
    if (!a1.ok) say(`architecture agent: ${a1.note}`)
    say("splicing implementations…")
    await archmode("splice", work, bodiesFile, log)

    // Phase 2: implementation agent fills in new stubs + satisfies the goal.
    const stubs = findDeclareStubs(work)
    say(`implementation pass (${stubs.length} stub file(s))…`)
    const implContext = await buildContext(work, targets, log, c.contextBudget)
    const archHandoff =
      `\n\nAn architecture pass already restructured the signatures for this change.` +
      (stubs.length
        ? ` These files still contain \`declare\` declarations with no implementation — remove the \`declare\` keyword and implement them: ${stubs.join(", ")}.`
        : "") +
      ` Test files may contain stub tests that throw "not implemented" — implement those and make them pass.`
    const a2 = await runAgent(
      buildImplPrompt(implContext, sandboxNote(work), goalLine, verifyNote) + archHandoff,
      work, timeoutMs, agentLog, mcpConfigPath, model,
    )
    agentOk = a1.ok && a2.ok
    agentNote = [a1.ok ? null : `arch: ${a1.note}`, a2.ok ? null : `impl: ${a2.note}`].filter(Boolean).join("; ") || undefined
  } else {
    say("building context…")
    const context = await buildContext(work, targets, log, c.contextBudget)
    say(`context: ${context.length} chars; running implementation agent…`)
    const a = await runAgent(buildImplPrompt(context, sandboxNote(work), goalLine, verifyNote), work, timeoutMs, agentLog, mcpConfigPath, model)
    agentOk = a.ok
    agentNote = a.note
    if (!a.ok) say(`agent: ${a.note}`)
  }

  const agentTestRuns = readAgentTestRuns(work)
  if (agentTestRuns) say(`agent test runs: ${agentTestRuns.runs} (${agentTestRuns.passed} passed, ${agentTestRuns.failed} failed, ${agentTestRuns.error} error; final: ${agentTestRuns.finalStatus})`)

  say("running checks…")
  const checks = await runChecks(c, caseDir, work, log)
  const pass = Object.values(checks).every(Boolean)
  const durationMs = Date.now() - started
  say(`${pass ? "PASS" : "FAIL"} ${JSON.stringify(checks)} (${Math.round(durationMs / 1000)}s)`)
  const r: TrialResult = { trial, agentOk, checks, pass, durationMs }
  if (agentNote) r.agentNote = agentNote
  if (agentTestRuns) r.agentTestRuns = agentTestRuns
  return r
}

// ---- pool ----

async function pool<T>(thunks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = new Array(thunks.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, thunks.length) }, async () => {
    while (next < thunks.length) {
      const i = next++
      results[i] = await thunks[i]!()
    }
  })
  await Promise.all(workers)
  return results
}

// ---- main ----

function loadCases(positional: string[], tierFilter?: string): { c: EvalCase; caseDir: string }[] {
  const paths = positional.length
    ? positional.map((p) => existsSync(p) ? resolve(p) : resolve(casesDir, p.endsWith(".json") ? p : `${p}.json`))
    : readdirSync(casesDir).filter((f) => f.endsWith(".json")).map((f) => resolve(casesDir, f))
  const loaded = paths.map((p) => ({ c: JSON.parse(readFileSync(p, "utf8")) as EvalCase, caseDir: dirname(p) }))
  return tierFilter ? loaded.filter(({ c }) => (c.tier ?? "capability") === tierFilter) : loaded
}

async function main() {
  const args = process.argv.slice(2)
  const positional: string[] = []
  let repeat: number | undefined
  let concurrency = Infinity
  let tier: string | undefined
  let modelOverride: string | undefined
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a === "--repeat") repeat = Number(args[++i])
    else if (a === "--concurrency") concurrency = Number(args[++i])
    else if (a === "--tier") tier = args[++i]
    else if (a === "--model") modelOverride = args[++i]
    else positional.push(a)
  }

  const cases = loadCases(positional, tier)
  if (!cases.length) { console.error("no cases matched"); process.exit(2) }

  const caseResults: CaseResult[] = cases.map(({ c }) => ({
    name: c.name, tier: c.tier ?? "capability", agent: c.agent, model: modelOverride ?? c.model ?? "sonnet", trials: [],
  }))
  const thunks: (() => Promise<void>)[] = []
  cases.forEach(({ c, caseDir }, ci) => {
    const n = repeat ?? c.repeat ?? 1
    for (let t = 1; t <= n; t++)
      thunks.push(async () => { caseResults[ci]!.trials.push(await runTrial(c, caseDir, t, modelOverride)) })
  })
  await pool(thunks, concurrency)

  // summary
  let deterministicFailures = 0
  console.log("\n=== eval summary ===")
  for (const r of caseResults) {
    r.trials.sort((a, b) => a.trial - b.trial)
    const passed = r.trials.filter((t) => t.pass).length
    const checkNames = Object.keys(r.trials[0]?.checks ?? {})
    const perCheck = checkNames.map((n) => `${n} ${r.trials.filter((t) => t.checks[n]).length}/${r.trials.length}`).join(", ")
    const required = r.tier === "deterministic"
    if (required) deterministicFailures += r.trials.length - passed
    console.log(`${passed === r.trials.length ? "✅" : required ? "❌" : "⚠️ "} ${r.name} [${r.tier}/${r.agent}/${r.model}] ${passed}/${r.trials.length} trials (${perCheck})`)
    for (const t of r.trials.filter((t) => !t.agentOk)) console.log(`     t${t.trial} agent: ${t.agentNote}`)
    const tr = r.trials.map((t) => t.agentTestRuns).filter((x): x is AgentTestRuns => !!x)
    if (tr.length) {
      const sum = (k: "runs" | "passed" | "failed" | "error") => tr.reduce((a, x) => a + x[k], 0)
      console.log(`     agent test runs: ${sum("runs")} (${sum("passed")} passed, ${sum("failed")} failed, ${sum("error")} error)`)
    }
  }

  mkdirSync(resultsDir, { recursive: true })
  const outPath = join(resultsDir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`)
  writeFileSync(outPath, JSON.stringify({ when: new Date().toISOString(), cases: caseResults }, null, 2))
  console.log(`\nresults written to ${relative(process.cwd(), outPath)}`)

  if (deterministicFailures > 0) {
    console.log(`\n${deterministicFailures} deterministic trial failure(s)`)
    process.exit(1)
  }
}

main().catch((e) => { console.error(e); process.exit(2) })
