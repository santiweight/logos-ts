import type { StorybookConfig } from "@storybook/react-vite"
import path from "node:path"

const studioSrc = process.env.LOGOS_TS_SRC
  ? path.resolve(process.env.LOGOS_TS_SRC, "../studio/src")
  : path.resolve("src")
const logosSrc = process.env.LOGOS_TS_SRC
  ? path.resolve(process.env.LOGOS_TS_SRC)
  : path.resolve("../src")

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  framework: "@storybook/react-vite",
  addons: [],
  viteFinal(viteConfig) {
    const storybookBase = process.env.LOGOS_STORYBOOK_BASE
    if (storybookBase) {
      viteConfig.base = storybookBase
      viteConfig.plugins = [
        ...(viteConfig.plugins ?? []),
        {
          name: "logos-storybook-base",
          enforce: "post",
          transformIndexHtml: {
            order: "post",
            handler(html) {
              return html.replace('src="/@id/', `src="${storybookBase}@id/`)
            },
          },
        },
      ]
    }

    if (process.env.LOGOS_SB_CACHE_DIR) viteConfig.cacheDir = process.env.LOGOS_SB_CACHE_DIR

    viteConfig.resolve = viteConfig.resolve ?? {}
    viteConfig.resolve.alias = {
      ...viteConfig.resolve.alias as Record<string, string>,
      "@logos-studio": studioSrc,
      "@logos-src": logosSrc,
    }

    viteConfig.server = viteConfig.server ?? {}
    viteConfig.server.allowedHosts = [
      ...(
        Array.isArray(viteConfig.server.allowedHosts)
          ? viteConfig.server.allowedHosts
          : []
      ),
      "127.0.0.1",
      "localhost",
    ]
    viteConfig.server.watch = {
      ...viteConfig.server.watch,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    }
    return viteConfig
  },
}

export default config
