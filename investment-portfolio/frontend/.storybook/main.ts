import type { StorybookConfig } from "@storybook/react-vite"
import path from "node:path"

const studioSrc = process.env.LOGOS_TS_SRC
  ? path.resolve(process.env.LOGOS_TS_SRC, "../studio/src")
  : path.resolve("../../logos-ts/studio/src")
const logosSrc = process.env.LOGOS_TS_SRC
  ? path.resolve(process.env.LOGOS_TS_SRC)
  : path.resolve("../../logos-ts/src")

const config: StorybookConfig = {
  stories: [
    "../components/**/*.stories.@(tsx|ts)",
    "../views/**/*.stories.@(tsx|ts)",
  ],
  addons: [],
  framework: { name: "@storybook/react-vite", options: {} },
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
      "react": path.resolve("node_modules/react"),
      "react-dom": path.resolve("node_modules/react-dom"),
      "react/jsx-runtime": path.resolve("node_modules/react/jsx-runtime.js"),
    }
    viteConfig.server = viteConfig.server ?? {}
    const publicPort = Number(process.env.LOGOS_PUBLIC_PORT)
    if (Number.isInteger(publicPort) && publicPort > 0) {
      const hmr = typeof viteConfig.server.hmr === "object" ? viteConfig.server.hmr : {}
      viteConfig.server.hmr = {
        ...hmr,
        clientPort: publicPort,
        protocol: process.env.LOGOS_PUBLIC_PROTOCOL === "wss" ? "wss" : "ws",
      }
    }
    viteConfig.server.watch = {
      ...viteConfig.server.watch,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    }
    return viteConfig
  },
}

export default config
