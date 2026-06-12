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

export function selectNextGoal<G extends { id: string; status: string }>(
  goals: G[],
  runningIds: { has(id: string): boolean },
): G | undefined {
  return goals.find((g) => g.status === "pending" && !runningIds.has(g.id))
}
