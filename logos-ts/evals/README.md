# Evals

Agent evals for logos-ts. Each case forks a subject codebase (hn-jobs), runs
the **same agent pipeline the studio runs** (prompts come from `src/prompt.ts`;
architecture cases run the real `archmode strip → agent → splice` pipeline
followed by an implementation pass), then runs checks the agent never sees.

```bash
npx tsx evals/run.ts                                 # all cases, default trial counts
npx tsx evals/run.ts rename-company-header           # one case by name
npx tsx evals/run.ts --tier deterministic            # the must-never-fail suite
npx tsx evals/run.ts --tier deterministic --repeat 5 # crank up trials
npx tsx evals/run.ts fuzzy-search-arch --concurrency 1
```

## Tiers

- **deterministic** — small, unambiguous tweaks (rename a header, change the
  empty-state text, bold an element, add a pinned-format column). These run
  multiple trials (`repeat`, default 3) and are expected to pass **every**
  trial; any failure makes the run exit 1. This is the regression gate for
  "can the agent reliably do trivial edits".
- **capability** — large changes (fuzzy search, scheduled ingestion) in code
  or architecture mode. Pass rate is reported but doesn't gate the exit code.

## Case format (`cases/*.json`)

```jsonc
{
  "name": "rename-company-header",
  "codebase": "../../../hn-jobs",          // fork source, relative to the case file
  "comment": { "target": "component:JobTable", "text": "…", "component": "JobTable" },
  "agent": "implementation",               // or "architecture"
  "tier": "deterministic",                 // or "capability" (default)
  "repeat": 3,                             // default trials (CLI --repeat overrides)
  "timeoutMs": 300000,                     // optional; defaults: impl 300s, arch 600s
  "checks": {
    "typecheck": { "cwd": "frontend", "cmd": ["npx", "tsc", "--noEmit"] },
    "behavior": {
      "oracle": ["../checks/foo.check.test.tsx", "../checks/fixtures.ts"],
      "cwd": "frontend",
      "cmd": ["npx", "vitest", "run", "foo.check.test.tsx"]
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
