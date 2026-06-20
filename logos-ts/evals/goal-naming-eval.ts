// Goal naming eval: calls haiku via the claude CLI with various inputs
// and checks that the generated names are reasonable.
//
//   npx tsx evals/goal-naming-eval.ts
//
import { execFile } from "node:child_process"
import { buildGoalNamePrompt, cleanGoalName, type GoalNameInput } from "../src/goal-naming.js"

interface Case {
  name: string
  input: GoalNameInput
  reject: RegExp[]
  maxLength?: number
}

const cases: Case[] = [
  {
    name: "verbose story-writing instructions should distill to component + intent",
    input: {
      text: "Write Storybook stories for the React component `ValueOrDash`. Use the project's existing Storybook style, imports, decorators, fixture patterns, and file naming. Cover the component's normal/default state, meaningful prop-driven variants, and any empty, loading, error, disabled, long-content, or interaction-relevant states that apply.",
      target: "component:ValueOrDash",
      component: "ValueOrDash",
      label: "ValueOrDash",
      mode: "code",
    },
    reject: [
      /^Write Storybook/i,
      /React Component$/i,
      /Use the project/i,
    ],
  },
  {
    name: "simple UI change gets a concrete name",
    input: {
      text: "make this bold",
      label: "span \"postings\"",
      htmlContext: "selected: <span>postings</span>",
      mode: "code",
    },
    reject: [
      /^Make This$/i,
      /^Bold$/i,
    ],
  },
  {
    name: "bug fix comment names the fix, not the method",
    input: {
      text: "This endpoint returns 500 when the post ID doesn't exist in the database, it should return 404 instead",
      target: "backend:getPostById",
      mode: "code",
    },
    reject: [
      /^Fix Endpoint$/i,
      /^This Endpoint/i,
      /database/i,
    ],
  },
  {
    name: "long refactoring comment gets distilled",
    input: {
      text: "Extract the validation logic from this handler into a separate utility function so we can reuse it in the batch import endpoint. The current inline validation is duplicated in three places.",
      target: "backend:handleSubmission",
      component: "SubmissionForm",
      mode: "code",
    },
    reject: [
      /^Extract The Validation/i,
      /separate utility/i,
      /three places/i,
    ],
  },
  {
    name: "arch mode comment about collapsing filters",
    input: {
      text: "The filter sidebar is too noisy; collapse advanced filters by default.",
      target: "component:FilterSidebar",
      component: "SearchFilters",
      label: "FilterSidebar",
      selector: ":scope > aside",
      htmlContext: "selected: <aside>Advanced filters Sort by date</aside>",
      mode: "arch",
    },
    reject: [
      /^The Filter/i,
      /too noisy/i,
      /sidebar/i,
    ],
  },
]

async function callHaiku(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("claude", ["-p", prompt, "--model", "haiku", "--output-format", "text"], {
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 8 * 1024,
      env: { ...process.env, LANG: "en_US.UTF-8" },
    }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`claude CLI failed: ${err.message}\nstderr: ${stderr}`))
      resolve(stdout)
    })
  })
}

async function runCase(c: Case): Promise<{ passed: boolean; name: string; raw: string; cleaned: string | null; failures: string[] }> {
  const prompt = buildGoalNamePrompt(c.input)
  const raw = await callHaiku(prompt)
  const cleaned = cleanGoalName(raw)
  const failures: string[] = []
  const maxLen = c.maxLength ?? 48

  if (!cleaned) {
    failures.push("cleanGoalName returned null")
  } else {
    if (cleaned.length > maxLen) {
      failures.push(`too long: ${cleaned.length} > ${maxLen}`)
    }
    const wordCount = cleaned.split(/\s+/).length
    if (wordCount < 2) failures.push(`too few words: ${wordCount}`)
    if (wordCount > 6) failures.push(`too many words: ${wordCount}`)

    for (const re of c.reject) {
      if (re.test(cleaned)) {
        failures.push(`matched reject pattern: ${re}`)
      }
    }
  }

  return { passed: failures.length === 0, name: c.name, raw: raw.trim(), cleaned, failures }
}

async function main() {
  console.log(`Running ${cases.length} goal-naming evals...\n`)
  let passed = 0
  let failed = 0

  for (const c of cases) {
    const result = await runCase(c)
    const icon = result.passed ? "✓" : "✗"
    console.log(`${icon} ${result.name}`)
    console.log(`  raw:     ${result.raw}`)
    console.log(`  cleaned: ${result.cleaned}`)
    if (!result.passed) {
      for (const f of result.failures) console.log(`  FAIL: ${f}`)
      failed++
    } else {
      passed++
    }
    console.log()
  }

  console.log(`${passed}/${cases.length} passed, ${failed} failed`)
  process.exit(failed > 0 ? 1 : 0)
}

main()
