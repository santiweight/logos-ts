# logos-ts

A TypeScript-native, **structure-first** code system: you describe and edit a
codebase at the *architecture* level (signatures, dependencies, stories) and
agents fill in / restructure the implementations. Built on **ts-morph** (the
TypeScript Compiler API); the only other hard dependency is the **`claude` CLI**
(spawned for agent runs). No coupling to the Python Logos project — this is a
clean-room reimplementation of the idea.

## Layout

```
logos-ts/        the tool
  src/           ts-morph engine
    project.ts        loadProject() — the shared ts-morph entry point
    architecture.ts   functions/classes/tests extraction
    dependencies.ts   symbol-level dependency graph (file#name keys)
    stories.ts        Storybook story → component mapping
    backend.ts        backend file/fn/class/method model + test attachment
    context.ts        agent context: full edit-file source + IMPORTED-BY +
                      forward deps + type-flow + callers + project map
    archmode.ts       strip declarations to `declare` signatures → splice
                      bodies/values back → infer imports (the "architecture view")
    build-index.ts    studio index (components + backend) for the IDE
    capture.ts        Storybook story → DOM-snapshot test
  studio/          the IDE (Vite + React)
    vite.config.ts    dev-server APIs: /api/index, /api/comments, /api/workspaces,
                      /api/agent/run (SSE; spawns `claude`, code|arch mode),
                      /api/capture
    src/              trees (components/backend), comments, workspaces, agent
                      terminal, diff highlighting
  evals/           eval harness (cases + checks + run.ts)
hn-jobs/           embedded demo app — a real TS port of the HN "who is hiring"
                   directory used as the subject codebase for the studio + evals
vinyl-collection/  Storybook/Vite demo app for crate browsing and selection QA
investment-portfolio/ Storybook/Vite demo app for portfolio review QA
household-maintenance/ Storybook/Vite demo app for operations queue QA
```

## Run the studio

```bash
# deps (first time)
pnpm install

# Demo Storybooks (back the studio's Story tab)
pnpm --dir vinyl-collection/frontend storybook
pnpm --dir investment-portfolio/frontend storybook
pnpm --dir household-maintenance/frontend storybook

# studio (auto-starts Storybook)
pnpm --dir logos-ts/studio dev              # auto-assigns a free port, prints the URL
```

Leaving a comment in the studio (alt-click a node) declares a change and
auto-runs an agent on a forked workspace; pick `code` or `arch` mode per comment.

## Git workflow

This repo uses **worktrees** — feature branches live under
`/Users/santiagoweight/projects/worktrees/logos-ts/<branch>/logos-ts` while
`main` is checked out at `/Users/santiagoweight/projects/logos-ts`. Because of
this, `git checkout main` will fail inside a worktree.

**Pushing a branch to main from a worktree:**

```bash
git fetch origin main
git rebase origin/main          # get on top of latest main
git push origin <branch>:main   # push directly to remote main
```

No PRs required — push directly to `origin/main` after rebasing.

## Tests / health check

`hn-jobs` has a single unified suite (backend + frontend) via Vitest:

```bash
cd hn-jobs && node scripts/healthcheck.mjs          # whole suite, JSON summary
cd hn-jobs && node scripts/healthcheck.mjs job-filters   # scope by path substring
```

The smaller demo apps each have frontend typecheck, unit/component tests, e2e
browser tests, Vite builds, Storybook builds, and strict lint:

```bash
pnpm --filter vinyl-collection-frontend typecheck
pnpm --filter vinyl-collection-frontend test:run
pnpm --filter vinyl-collection-frontend test:e2e
pnpm --filter vinyl-collection-frontend build
pnpm --filter vinyl-collection-frontend build-storybook
pnpm --filter vinyl-collection-frontend lint:strict

pnpm --filter investment-portfolio-frontend typecheck
pnpm --filter investment-portfolio-frontend test:run
pnpm --filter investment-portfolio-frontend test:e2e
pnpm --filter investment-portfolio-frontend build
pnpm --filter investment-portfolio-frontend build-storybook
pnpm --filter investment-portfolio-frontend lint:strict

pnpm --filter household-maintenance-frontend typecheck
pnpm --filter household-maintenance-frontend test:run
pnpm --filter household-maintenance-frontend test:e2e
pnpm --filter household-maintenance-frontend build
pnpm --filter household-maintenance-frontend build-storybook
pnpm --filter household-maintenance-frontend lint:strict
```

Strict linting is intentionally optional. Use typecheck/tests as the regular
verification gate; run `pnpm lint:strict` only for deliberate cleanup passes.
