# Evals

Agent evals for logos-ts. Each case forks a subject codebase (hn-jobs), runs
the **same agent pipeline the studio runs** (prompts come from `src/prompt.ts`;
architecture cases run the real `archmode strip → agent → splice` pipeline
followed by an implementation pass), then runs checks the agent never sees.

```bash
pnpm exec tsx evals/run.ts                                 # all cases, default trial counts
pnpm exec tsx evals/run.ts --quick                         # representative smoke suite, one trial each
pnpm exec tsx evals/run.ts rename-company-header           # one case by name
pnpm exec tsx evals/run.ts --tier deterministic            # the must-never-fail suite
pnpm exec tsx evals/run.ts --tier deterministic --repeat 5 # crank up trials
pnpm exec tsx evals/run.ts fuzzy-search-arch --concurrency 1
pnpm exec tsx evals/run.ts --quick --dry-run               # print selected quick cases without agents
pnpm exec tsx evals/run.ts --repeat 3 --concurrency 3      # benchmark baseline
pnpm exec tsx evals/summarize-results.ts                   # summarize latest result JSON
```

## Agent backend spike

The harness can run the same eval pipeline through a few experimental backends:

```bash
pnpm exec tsx evals/run.ts rename-company-header --backend claude-cli
pnpm exec tsx evals/run.ts rename-company-header --backend claude-cli-safe
ANTHROPIC_API_KEY=... pnpm exec tsx evals/run.ts rename-company-header --backend claude-cli-bare
ANTHROPIC_API_KEY=... pnpm exec tsx evals/run.ts rename-company-header --backend claude-sdk
CODEX_API_KEY=... pnpm exec tsx evals/run.ts rename-company-header --backend codex-cli
```

Backends:

- `claude-cli` preserves the historical `claude -p` behavior.
- `claude-cli-safe` disables Claude Code customizations while preserving normal local auth, which makes it a useful low-friction latency baseline.
- `claude-cli-bare` uses Claude Code bare mode. This is the faster scripted mode, but it requires API-key or provider auth because bare mode skips OAuth/keychain reads.
- `claude-sdk` uses `@anthropic-ai/claude-agent-sdk` directly with `cwd`, Claude Code tools, bypass permissions, no filesystem settings, and no session persistence.
- `codex-cli` shells to `codex exec - --sandbox workspace-write --skip-git-repo-check`. The local machine must have Codex installed and authenticated; set `CODEX_API_KEY` for one-off API-key automation.

Optional knobs:

```bash
LOGOS_EVAL_AGENT=claude-cli-safe pnpm exec tsx evals/run.ts --tier deterministic
LOGOS_EVAL_MODEL=sonnet pnpm exec tsx evals/run.ts rename-company-header
LOGOS_CODEX_MODEL=gpt-5.5 pnpm exec tsx evals/run.ts fuzzy-search --backend codex-cli
LOGOS_CODEX_MODEL=gpt-5.4-mini pnpm exec tsx evals/run.ts fuzzy-search --backend codex-cli
LOGOS_CODEX_SANDBOX=danger-full-access pnpm exec tsx evals/run.ts fuzzy-search --backend codex-cli
LOGOS_CODEX_JSON=1 pnpm exec tsx evals/run.ts fuzzy-search --backend codex-cli
```

Materialization can also be switched from per-trial `cpSync` to a reusable in-memory source snapshot:

```bash
pnpm exec tsx evals/run.ts --tier deterministic --materializer memory
LOGOS_EVAL_MATERIALIZER=memory pnpm exec tsx evals/run.ts fuzzy-search --repeat 3
```

This still writes a real workspace before the agent/checks run, but it avoids rereading and rescanning the source fixture for every trial.

## Tiers

- **deterministic** — small, unambiguous tweaks (rename a header, change the
  empty-state text, bold an element, add a pinned-format column). These run
  multiple trials (`repeat`, default 3) and are expected to pass **every**
  trial; any failure makes the run exit 1. This is the regression gate for
  "can the agent reliably do trivial edits".
- **capability** — large changes (fuzzy search, scheduled ingestion) in code
  or architecture mode. Pass rate is reported but doesn't gate the exit code.

`--quick` selects a small representative smoke suite from current root-layout
HN Jobs cases and caps default repeats at one trial per case. It is meant for
local iteration before spending time and tokens on the full matrix; explicit
case names, `--tier`, and `--repeat` still work with it.

## Case format (`cases/*.json`)

```jsonc
{
  "name": "rename-company-header",
  "codebase": "../../demos/hn-jobs",          // fork source, relative to the case file
  "comment": { "target": "component:JobTable", "text": "…", "component": "JobTable" },
  "agent": "implementation",               // or "architecture"
  "tier": "deterministic",                 // or "capability" (default)
  "repeat": 3,                             // default trials (CLI --repeat overrides)
  "timeoutMs": 300000,                     // optional; defaults: impl 300s, arch 600s
  "checks": {
    "typecheck": { "cwd": "frontend", "cmd": ["pnpm", "exec", "tsc", "--noEmit"] },
    "behavior": {
      "oracle": ["../checks/foo.check.test.tsx", "../checks/fixtures.ts"],
      "cwd": "frontend",
      "cmd": ["pnpm", "exec", "vitest", "run", "foo.check.test.tsx"]
    }
  }
}
```

`oracle` files are copied into `<fork>/<cwd>/` right before the check runs, so
the agent can never overfit to them. `checks/fixtures.ts` holds the shared
`baseJob`/`filters` fixture.

## Architecture cases

Arch cases exercise the full production flow: the fork is stripped to
`declare` signatures, the architecture agent restructures them (no bodies),
original bodies are spliced back, then an implementation agent removes
remaining `declare` stubs, implements `not implemented` stub tests, and
satisfies the original goal. Behavior oracles therefore run against fully
implemented code. For unambiguous oracles, big arch cases pin the public
contract (file + export signatures) in the comment text — see
`scheduled-ingest-arch.json`.

## Test-runner MCP

Eval agents get the same test-runner MCP that studio agents get (detected via
`detectProject`, e.g. hn-jobs' `scripts/healthcheck.mjs`): the suite auto-runs
on file save and the agent polls `test_results(wait_for_completion=true)`.
Every completed run is appended to
`<fork>/.logos_cache/test-runner-mcp/runs.jsonl`; the harness aggregates these
per trial (`agentTestRuns` in the results JSON, plus a summary line), so you
can see how often the agent's own test loop passed/failed independently of the
oracle checks.

## Output

Per-trial workspaces and logs live in `cases/runs/<case>/t<N>/` (`work/` is the
fork, `agent.log` + `trial.log` next to it). A JSON summary of every run is
written to `results/<timestamp>.json`; a pass-rate table is printed at the end.
The benchmark number is the hidden-check pass rate: successful hidden checks
divided by total hidden checks. The harness reports that number overall and on
two mode axes:

- `implementation` covers implementation-mode cases.
- `architecture` covers architecture, testing, and arch-impl cases.

Use `pnpm exec tsx evals/summarize-results.ts <result.json>` to recompute those
numbers for a saved run.
