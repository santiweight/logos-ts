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

export function buildArchPrompt(context: string, sandbox: string, goalLine: string): string {
  return `${context}\n\n${sandbox}` +
    `You are in ARCHITECTURE MODE. The code is shown as pure SIGNATURES using \`declare\` — no bodies, no \`=\`, no values. The real implementations are filled back in automatically after you finish.\n\n` +
    `Tests appear as \`test("name")\` or \`test("name", () => expr)\` lines above the declaration they cover. You can add new tests (name-only or with a single expression), remove tests, or leave them. Test lines are written back to \`.test.ts\` files automatically — name-only tests get a placeholder body.\n\n` +
    `Restructure the ARCHITECTURE to satisfy the change: move / split / rename / add these \`declare\` signatures across files. Keep everything as bare \`declare\` declarations — do NOT write bodies, values, or import statements.\n\n` +
    `Change requests:\n${goalLine}\n`
}

export function selectNextGoal<G extends { id: string; status: string }>(
  goals: G[],
  runningIds: { has(id: string): boolean },
): G | undefined {
  return goals.find((g) => g.status === "pending" && !runningIds.has(g.id))
}
