export function buildStoryWritingPrompt(componentName: string): string {
  return [
    `Write Storybook stories for the React component \`${componentName}\`.`,
    "Use the project's existing Storybook style, imports, decorators, fixture patterns, and file naming.",
    "If a colocated stories file already exists, improve it instead of duplicating stories.",
    "Cover the component's normal/default state, meaningful prop-driven variants, and any empty, loading, error, disabled, long-content, or interaction-relevant states that apply.",
    "IMPORTANT — Storybook bundles run in the browser. Every file in the import chain from the stories file must be browser-safe. If the target component lives in a file that imports server-only modules (Prisma, database clients, Node `fs`/`crypto`, server actions, ORM helpers), you CANNOT import the component from that file — the bundler will pull in the entire module graph and crash on the server-only imports. Instead, extract a presentational component into its own new file (e.g. `DirectoryView.tsx` beside `page.tsx`) that takes data as props and has zero server-only imports. Have the original server component import and render the new presentational component, and have the stories file import from the new file. The presentational component must be exported so the index can detect it.",
    "Use small deterministic fixtures and generic sample data. Do not use network, database, timers, randomness, or production-only services.",
    "Keep the examples domain-neutral unless the component's public API requires specific domain-shaped data.",
    "Prefer typed `Meta` and `StoryObj` exports when that matches the project, and keep the stories typechecking.",
  ].join("\n")
}
