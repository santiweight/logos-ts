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
    // node_modules is shared (symlinked) across workspace forks; the default
    // cacheDir (node_modules/.vite) would be racy across concurrent instances.
    if (process.env.LOGOS_SB_CACHE_DIR) viteConfig.cacheDir = process.env.LOGOS_SB_CACHE_DIR
    viteConfig.resolve = viteConfig.resolve ?? {}
    viteConfig.resolve.alias = {
      ...viteConfig.resolve.alias as Record<string, string>,
      "@logos-studio": path.resolve(process.env.LOGOS_TS_SRC!, "../studio/src"),
      "@logos-src": path.resolve(process.env.LOGOS_TS_SRC!),
    }
    // Agent file writes can trigger HMR mid-write, causing transient
    // "does not provide an export named X" errors — wait for writes to settle.
    viteConfig.server = viteConfig.server ?? {}
    viteConfig.server.watch = {
      ...viteConfig.server.watch,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    }
    return viteConfig
  },
}

export default config
