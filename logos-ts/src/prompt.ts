export interface GoalFields {
  label: string
  text: string
  component?: string | null
  storyId?: string | null
  selector?: string | null
  appPath?: string | null
  runTargetId?: string | null
}

export function buildElementContext(goal: Pick<GoalFields, "component" | "storyId" | "selector" | "appPath" | "runTargetId">): string {
  return [
    goal.component && `component: ${goal.component}`,
    goal.appPath && `app path: ${goal.appPath}`,
    goal.runTargetId && `run target: ${goal.runTargetId}`,
    goal.storyId && `story: ${goal.storyId}`,
    goal.selector && `element: ${goal.selector}`,
  ].filter(Boolean).join(", ")
}

export function buildGoalLine(goal: GoalFields): string {
  const elementContext = buildElementContext(goal)
  return `- (${goal.label}${elementContext ? ` [${elementContext}]` : ""}) ${goal.text}`
}

export const BEHAVIORAL_TEST_GUIDANCE =
  `Define acceptance criteria in the architecture itself. For each user-visible behavior or important data contract, add focused \`test("...")\` lines near the declaration that should own the behavior. Prefer tests that pin expected outcomes, explicit non-goals, edge cases, ordering, state transitions, error handling, and integration with existing constraints. When the request uses ambiguous product language, turn it into concrete examples of what should work and what should not work before choosing implementation details. If the change needs ranking, scoring, parsing, validation, normalization, authorization, scheduling, or other decision logic, expose that logic through a named helper with a clear return type and add unit-level tests for it. Pair those unit-level tests with a small number of flow-level tests that prove the helper is wired into the user-facing or API-facing path.`

export const FRONTEND_BACKEND_SPLIT_GUIDANCE =
  `Keep UI code focused on presentation: rendering, layout, styling, event wiring, local interaction state, and small display-only formatting. Put substantive data behavior in backend/domain/data modules or server-side helpers instead of React components: filtering, sorting, ranking, scoring, parsing, validation, aggregation, authorization-sensitive decisions, persistence, and transformations that may grow with data size. If a page or component needs that behavior, expose a named reusable helper from the existing backend/domain module and have the UI call it or pass through its result; do not hide business logic or potentially heavy data work inside JSX/component-local helpers.`

/**
 * The architecture-mode agent prompt. Shared by workspace-manager and the eval
 * harness so evals exercise exactly the production prompt.
 */
export function buildArchPrompt(context: string, sandbox: string, goalLine: string): string {
  return `${context}\n\n${sandbox}` +
    `You are in ARCHITECTURE MODE. Non-component code is shown as pure SIGNATURES using \`declare\` — no bodies, no \`=\`, no values. The real implementations are filled back in automatically after you finish.\n\n` +
    `EXCEPTION: React components appear IN FULL, because on the frontend the render tree is the architecture. You may edit component JSX, props wiring, and state placement directly — those edits are kept as-is, not regenerated.\n\n` +
    `Tests appear as \`test("name")\` or \`test("name", () => expr)\` lines above the declaration they cover. You can add new tests (name-only or with a single expression), remove tests, or leave them. Test lines are written back to \`.test.ts\` files automatically — name-only tests get a placeholder body.\n\n` +
    `Restructure the ARCHITECTURE to satisfy the change: move / split / rename / add \`declare\` signatures across files, and reshape component JSX where the change is visual or structural. Keep non-component declarations as bare \`declare\` signatures — do NOT write bodies, values, or import statements for them.\n\n` +
    `${BEHAVIORAL_TEST_GUIDANCE} ${FRONTEND_BACKEND_SPLIT_GUIDANCE}\n\n` +
    `Choose the smallest architecture that makes the implementation obvious. Reuse existing modules and public flows, keep stable APIs unless the request requires changing them, and only introduce new files when the existing ownership boundary is wrong.\n\n` +
    `Change requests:\n${goalLine}\n\n` +
    `When you are finished, end with a brief summary of what you changed (files modified, signatures added/removed/renamed). Keep it under 5 sentences.\n`
}

export function buildImplPrompt(context: string, sandbox: string, goalLine: string, verifyNote: string): string {
  return `${context}\n\n${sandbox}` +
    `You are an implementation agent. The ARCHITECTURE CONTEXT above already lists every file and symbol your change touches — do NOT use grep/find/ls to explore the codebase. The full source of files you need to edit is shown above; Read a file before editing it (tool requirement).\n\n` +
    `Address these change requests:\n${goalLine}\n\n` +
    `Keep exported signatures stable unless a change requires otherwise; reuse existing helpers; make it typecheck. ${FRONTEND_BACKEND_SPLIT_GUIDANCE} ${verifyNote}\n\n` +
    `When you are finished, end with a brief summary of what you changed (files modified, what was added/fixed/refactored). Keep it under 5 sentences.`
}

export function buildArchImplementationPrompt(context: string, sandbox: string, goalLine: string, verifyNote: string): string {
  return `${context}\n\n${sandbox}` +
    `The architecture pass is complete and has been spliced back into the full source tree. You are now the implementation agent for the same goal.\n\n` +
    `Implement the architecture that is already present: fill in new or changed bodies, replace any \`not implemented\` placeholder tests with real assertions, and keep the declared contracts stable unless implementation reveals a concrete type/signature mistake. Do not redesign the architecture unless it is required to make the code compile or satisfy the tests.\n\n` +
    `Address these change requests:\n${goalLine}\n\n` +
    `Reuse existing helpers and data flow, make it typecheck, and keep the app behavior intuitive for the user-facing workflow. ${FRONTEND_BACKEND_SPLIT_GUIDANCE} ${verifyNote}\n\n` +
    `When you are finished, end with a brief summary of what you implemented and which tests you satisfied. Keep it under 5 sentences.`
}

export function buildVerifyNote(hasTests: boolean): string {
  return `Do not run lint as part of default verification; strict lint is an optional cleanup pass only when explicitly requested.` +
    (hasTests
      ? ` Do NOT run tests yourself. Tests auto-run on every file save via the test-runner MCP. ` +
        `After making changes, call \`test_results(wait_for_completion=true)\` to wait for the auto-triggered run to finish and see the results. ` +
        `Iterate until the tests relevant to your change pass; ignore pre-existing stub failures you didn't cause. ` +
        `Always check test_results before finishing — do not consider your work done until tests pass.`
      : ` This project has no automated test runner configured. Verify your changes manually.`)
}

export function buildArchImplPrompt(
  context: string,
  sandbox: string,
  goalLine: string,
  archDiff: string,
  verifyNote: string,
): string {
  return `${context}\n\n` +
    `# ARCHITECTURE CHANGE\n\n` +
    `An architecture agent restructured the codebase for this change. The codebase now contains \`declare\` stubs where you must write function bodies, and test stubs with \`throw new Error("not implemented")\` where you must write real assertions.\n\n` +
    `## Architecture diff:\n\`\`\`diff\n${archDiff}\n\`\`\`\n\n` +
    `${sandbox}` +
    `You are an implementation agent finishing work started by an architecture agent. Fill in all \`declare\` function bodies and test stubs. Wire the new helpers into the existing code as the architecture indicates. Make sure existing tests still pass.\n\n` +
    `Change requests:\n${goalLine}\n\n` +
    `${verifyNote}\n\n` +
    `When you are finished, end with a brief summary of what you implemented. Keep it under 5 sentences.`
}

export function isStoryGenerationRequest(text: string): boolean {
  return /\bStorybook stories\b|\bstories for (?:this )?React component\b|\bcomponent stories\b/i.test(text)
}

export function isWebResearchRequest(text: string): boolean {
  return /\b(?:web|internet|online|browser|browse|browsing|google|research)\b|\bsearch (?:the )?web\b|\blook(?:ed|ing)? up\b|\bwebsearch\b|\bwebfetch\b/i.test(text)
}

export function buildStoryGenerationSystemPrompt(): string {
  return [
    "When generating Storybook stories, keep component stories deterministic and self-contained.",
    "Use the project's existing Storybook style, imports, decorators, fixture patterns, and file naming.",
    "If a colocated stories file already exists, improve it instead of duplicating stories.",
    "Cover the component's normal/default state, meaningful prop-driven variants, and any empty, loading, error, disabled, long-content, or interaction-relevant states that apply.",
    "Use small deterministic fixtures and generic sample data. Do not use network, database, timers, randomness, or production-only services.",
    "Keep examples domain-neutral unless the component's public API requires specific domain-shaped data.",
    "Prefer typed Meta and StoryObj exports when that matches the project, and keep the stories typechecking.",
    "Storybook stories run inside Storybook's preview iframe. If the component under test creates its own iframe, that nested iframe is a runtime boundary that Storybook does not automatically provide.",
    "Do not hard-code localhost ports, external Storybook URLs, workspace proxy URLs, or app-owned preview routes in component stories. In particular, avoid values like `http://localhost:6006`, `/portable-story.html`, or `${storybookUrl}/iframe.html` unless the story itself provisions that runtime.",
    "Do not treat iframe runtime props as ordinary visual variants. Avoid `renderer: \"storybook\"`, `storyRenderer: \"storybook\"`, `storybookUrl`, and similar props in component stories unless the task explicitly asks for an integration story and provides the runtime.",
    "If the component has a renderer/storyRenderer prop, choose one safe default value for visual stories and do not add a separate storybook-mode story just to exercise iframe URL construction.",
    "If the target component renders a nested iframe whose src points at an app-owned route, dynamic localhost port, workspace proxy, generated preview page, or external Storybook runtime, do not make the story depend on that live iframe target.",
    "Mock that iframe boundary in Storybook instead. If the component has no way to do that, add a small optional story/test seam such as a renderStoryFrame or renderFrame prop that defaults to the real iframe in production, and use that seam from the story.",
    "When mocking an iframe boundary, name or comment the mock clearly with words like mockFrame, fixture frame, iframe boundary, nested iframe, app runtime, or portable-story so future readers can see why the real iframe is not rendered.",
    "Do not add component-story variants that exercise live iframe runtime selection, such as renderer/storyRenderer set to storybook, storybookUrl values, hard-coded localhost ports, or external Storybook hosts, unless the user explicitly asks for an integration/runtime story.",
    "Even when the iframe is mocked, do not add a StorybookRenderer or storybook-mode variant merely to cover URL construction. That branch belongs in unit or integration tests, not component stories.",
    "Use app or browser integration tests for the real iframe runtime; component stories should only verify layout, state, props, and fallback UI around the iframe boundary.",
    "Storybook bundles run in the browser. Every file in the import chain from the stories file must be browser-safe.",
    "If the target is a server component, route file, or file with server-only imports such as Prisma, database clients, Node fs/crypto, server actions, or ORM helpers, do not import it directly from stories.",
    "Instead, extract a browser-safe presentational component into its own file that takes data as props and has zero server-only imports.",
    "Update the original server component to import and render that presentational component with its computed props. Do not leave the extracted component used only by stories.",
    "Export the presentational component so the index can detect it.",
  ].join("\n")
}

export function selectNextGoal<G extends { id: string; status: string }>(
  goals: G[],
  runningIds: { has(id: string): boolean },
): G | undefined {
  return goals.find((g) => g.status === "pending" && !runningIds.has(g.id))
}
