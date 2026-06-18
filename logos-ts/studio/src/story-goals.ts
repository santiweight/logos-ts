export function buildStoryWritingPrompt(componentName: string): string {
  return [
    `Write Storybook stories for the React component \`${componentName}\`.`,
    "Use the project's existing Storybook style, imports, decorators, fixture patterns, and file naming.",
    "If a colocated stories file already exists, improve it instead of duplicating stories.",
    "Cover the component's normal/default state, meaningful prop-driven variants, and any empty, loading, error, disabled, long-content, or interaction-relevant states that apply.",
    "Use small deterministic fixtures and generic sample data. Do not use network, database, timers, randomness, or production-only services.",
    "Keep the examples domain-neutral unless the component's public API requires specific domain-shaped data.",
    "Prefer typed `Meta` and `StoryObj` exports when that matches the project, and keep the stories typechecking.",
  ].join("\n")
}
