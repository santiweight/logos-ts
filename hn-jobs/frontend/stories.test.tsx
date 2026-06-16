import { render } from "@testing-library/react"
import { composeStories } from "@storybook/react"

const storyModules = import.meta.glob<Record<string, unknown>>(
  "./**/*.stories.tsx",
  { eager: true },
)

for (const [path, mod] of Object.entries(storyModules)) {
  const stories = composeStories(mod as any)
  for (const [name, Story] of Object.entries(stories)) {
    const StoryComponent = Story as React.FC
    test(`captured: ${path} / ${name}`, () => {
      const { container } = render(<StoryComponent />)
      expect(container.innerHTML).toMatchSnapshot()
    })
  }
}
