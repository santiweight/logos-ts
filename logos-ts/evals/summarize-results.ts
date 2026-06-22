import { existsSync, readFileSync, readdirSync } from "node:fs"
import { dirname, resolve } from "node:path"

type BenchmarkMode = "implementation" | "architecture"

interface TrialResult {
  caseName: string
  agent?: "implementation" | "architecture" | "testing" | "arch-impl"
  mode?: BenchmarkMode
  results: Record<string, boolean>
  passedCheckCount?: number
  checkCount?: number
}

interface RunSummary {
  startedAt?: string
  finishedAt?: string
  results: TrialResult[]
}

interface Bucket {
  passed: number
  total: number
}

const evalsRoot = dirname(import.meta.url.replace("file://", ""))

function latestResultsFile(): string {
  const resultsDir = resolve(evalsRoot, "results")
  const files = readdirSync(resultsDir)
    .filter((name) => name.endsWith(".json"))
    .sort()
  const latest = files.at(-1)
  if (!latest) throw new Error(`No result JSON files found in ${resultsDir}`)
  return resolve(resultsDir, latest)
}

function benchmarkMode(result: TrialResult): BenchmarkMode {
  if (result.mode) return result.mode
  return result.agent === "implementation" ? "implementation" : "architecture"
}

function checkCounts(result: TrialResult): Bucket {
  if (typeof result.passedCheckCount === "number" && typeof result.checkCount === "number") {
    return { passed: result.passedCheckCount, total: result.checkCount }
  }

  const values = Object.values(result.results)
  return {
    passed: values.filter(Boolean).length,
    total: values.length,
  }
}

function formatRate(bucket: Bucket): string {
  const pct = bucket.total === 0 ? 0 : (bucket.passed / bucket.total) * 100
  return `${bucket.passed}/${bucket.total} (${pct.toFixed(1)}%)`
}

function main(): void {
  const path = process.argv[2] ? resolve(process.argv[2]) : latestResultsFile()
  if (!existsSync(path)) throw new Error(`Result file not found: ${path}`)

  const summary: RunSummary = JSON.parse(readFileSync(path, "utf8"))
  const buckets: Record<BenchmarkMode | "overall", Bucket> = {
    architecture: { passed: 0, total: 0 },
    implementation: { passed: 0, total: 0 },
    overall: { passed: 0, total: 0 },
  }

  for (const result of summary.results) {
    const counts = checkCounts(result)
    const mode = benchmarkMode(result)
    buckets[mode].passed += counts.passed
    buckets[mode].total += counts.total
    buckets.overall.passed += counts.passed
    buckets.overall.total += counts.total
  }

  console.log(`Results: ${path}`)
  if (summary.startedAt && summary.finishedAt) {
    console.log(`Window: ${summary.startedAt} -> ${summary.finishedAt}`)
  }
  console.log(`architecture: ${formatRate(buckets.architecture)}`)
  console.log(`implementation: ${formatRate(buckets.implementation)}`)
  console.log(`overall: ${formatRate(buckets.overall)}`)
}

main()
