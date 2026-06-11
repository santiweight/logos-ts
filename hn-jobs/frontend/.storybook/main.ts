import type { StorybookConfig } from "@storybook/react-vite"
import { commentsServerPlugin } from "./comments-server"

const config: StorybookConfig = {
  stories: [
    "../components/**/*.stories.@(tsx|ts)",
    "../views/**/*.stories.@(tsx|ts)",
  ],
  addons: [],
  framework: { name: "@storybook/react-vite", options: {} },
  // Serve the story-comments persistence endpoint from the dev server so pinned
  // comments are written to <project>/.logos/ where backend agents read them.
  viteFinal(viteConfig) {
    viteConfig.plugins = viteConfig.plugins ?? []
    viteConfig.plugins.push(commentsServerPlugin())
    return viteConfig
  },
}

export default config
