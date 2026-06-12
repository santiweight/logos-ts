import type { StorybookConfig } from "@storybook/react-vite"
import path from "node:path"

const config: StorybookConfig = {
  stories: [
    "../components/**/*.stories.@(tsx|ts)",
    "../views/**/*.stories.@(tsx|ts)",
  ],
  addons: [],
  framework: { name: "@storybook/react-vite", options: {} },
  viteFinal(viteConfig) {
    viteConfig.resolve = viteConfig.resolve ?? {}
    viteConfig.resolve.alias = {
      ...viteConfig.resolve.alias as Record<string, string>,
      "@logos-studio": path.resolve(process.env.LOGOS_TS_SRC!, "../studio/src"),
      "@logos-src": path.resolve(process.env.LOGOS_TS_SRC!),
    }
    return viteConfig
  },
}

export default config
