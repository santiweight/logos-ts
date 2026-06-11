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
hn-jobs/           demo app — a real TS port of the HN "who is hiring" directory
                   used as the subject codebase for the studio + evals
```

## Run the studio

```bash
# deps (first time)
cd logos-ts && npm install
cd studio && npm install
cd ../../hn-jobs/frontend && npm install

# Storybook (backs the studio's Story tab) — from hn-jobs/frontend
npm run storybook        # → http://localhost:6006

# studio — from logos-ts/studio
npm run dev              # → http://localhost:5180
```

Leaving a comment in the studio (alt-click a node) declares a change and
auto-runs an agent on a forked workspace; pick `code` or `arch` mode per comment.

## Tests / health check

`hn-jobs` has a single unified suite (backend + frontend) via Vitest:

```bash
cd hn-jobs && node scripts/healthcheck.mjs          # whole suite, JSON summary
cd hn-jobs && node scripts/healthcheck.mjs job-filters   # scope by path substring
```
