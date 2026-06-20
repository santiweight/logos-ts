export interface GoalFields {
  label: string
  text: string
  component?: string | null
  storyId?: string | null
  selector?: string | null
}

export function buildElementContext(goal: Pick<GoalFields, "component" | "storyId" | "selector">): string {
  return [
    goal.component && `component: ${goal.component}`,
    goal.storyId && `story: ${goal.storyId}`,
    goal.selector && `element: ${goal.selector}`,
  ].filter(Boolean).join(", ")
}

export function buildGoalLine(goal: GoalFields): string {
  const elementContext = buildElementContext(goal)
  return `- (${goal.label}${elementContext ? ` [${elementContext}]` : ""}) ${goal.text}`
}

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
    `Change requests:\n${goalLine}\n\n` +
    `When you are finished, end with a brief summary of what you changed (files modified, signatures added/removed/renamed). Keep it under 5 sentences.\n`
}

export function buildImplPrompt(context: string, sandbox: string, goalLine: string, verifyNote: string): string {
  return `${context}\n\n${sandbox}` +
    `You are an implementation agent. The ARCHITECTURE CONTEXT above already lists every file and symbol your change touches — do NOT use grep/find/ls to explore the codebase. The full source of files you need to edit is shown above; Read a file before editing it (tool requirement).\n\n` +
    `Address these change requests:\n${goalLine}\n\n` +
    `Keep exported signatures stable unless a change requires otherwise; reuse existing helpers; make it typecheck. ${verifyNote}\n\n` +
    `When you are finished, end with a brief summary of what you changed (files modified, what was added/fixed/refactored). Keep it under 5 sentences.`
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

export function isStoryGenerationRequest(text: string): boolean {
  return /\bStorybook stories\b|\bstories for (?:this )?React component\b|\bcomponent stories\b/i.test(text)
}

export function buildStoryGenerationSystemPrompt(): string {
  return [
    "When generating Storybook stories, keep component stories deterministic and self-contained.",
    "If the target component renders a nested iframe whose src points at an app-owned route, dynamic localhost port, workspace proxy, generated preview page, or external Storybook runtime, do not make the story depend on that live iframe target.",
    "Mock that iframe boundary in Storybook instead. If the component has no way to do that, add a small optional story/test seam such as a renderStoryFrame or renderFrame prop that defaults to the real iframe in production, and use that seam from the story.",
    "Do not add component-story variants that exercise live iframe runtime selection, such as renderer/storyRenderer set to storybook, storybookUrl values, hard-coded localhost ports, or external Storybook hosts, unless the user explicitly asks for an integration/runtime story.",
    "Use app or browser integration tests for the real iframe runtime; component stories should only verify layout, state, props, and fallback UI around the iframe boundary.",
  ].join("\n")
}

export function buildStoryGenerationContext(): string {
  return [
    "# STORYBOOK STORY-GENERATION CONTEXT",
    "Storybook stories run inside Storybook's preview iframe. If the component under test creates its own iframe, that nested iframe is a runtime boundary that Storybook does not automatically provide.",
    "Do not hard-code localhost ports, external Storybook URLs, workspace proxy URLs, or app-owned preview routes in component stories. In particular, avoid values like `http://localhost:6006`, `/portable-story.html`, or `${storybookUrl}/iframe.html` unless the story itself provisions that runtime.",
    "Do not treat iframe runtime props as ordinary visual variants. Avoid `renderer: \"storybook\"`, `storyRenderer: \"storybook\"`, `storybookUrl`, and similar props in component stories unless the task explicitly asks for an integration story and provides the runtime.",
    "For iframe-owning components, prefer a deterministic mock/fixture for the nested frame: add or use an optional `renderStoryFrame`/`renderFrame`-style prop that defaults to the real iframe, then pass a mock frame from the story. Keep startup, loading, and failure states as ordinary component stories when they do not need the nested iframe target.",
  ].join("\n")
}

export function selectNextGoal<G extends { id: string; status: string }>(
  goals: G[],
  runningIds: { has(id: string): boolean },
): G | undefined {
  return goals.find((g) => g.status === "pending" && !runningIds.has(g.id))
}
