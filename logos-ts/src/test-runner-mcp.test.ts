import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"

const root = resolve(fileURLToPath(new URL("..", import.meta.url)))

function inheritedEnv(overrides: Record<string, string>): Record<string, string> {
  return {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    ...overrides,
  }
}

test("runs test commands with a test-mode environment", async () => {
  const cwd = mkdtempSync(resolve(tmpdir(), "logos-test-runner-mcp-"))
  writeFileSync(
    resolve(cwd, "check-env.mjs"),
    `
const cacheDir = process.env.LOGOS_VITEST_CACHE_DIR || ""
const ok = process.env.NODE_ENV === "test" && cacheDir.includes(".logos_cache/test-runner-mcp")
console.log(JSON.stringify({
  total: 1,
  passed: ok ? 1 : 0,
  failed: ok ? 0 : 1,
  failures: ok ? [] : [{ message: \`NODE_ENV=\${process.env.NODE_ENV}; cacheDir=\${cacheDir}\` }],
}))
process.exit(ok ? 0 : 1)
`.trimStart(),
  )

  const client = new Client({ name: "test-runner-mcp-test", version: "0.0.0" })
  const transport = new StdioClientTransport({
    command: resolve(root, "node_modules/.bin/tsx"),
    args: [
      resolve(root, "src/test-runner-mcp.ts"),
      JSON.stringify({
        cwd,
        command: ["node", "check-env.mjs"],
        watch: [],
        filePattern: "\\.(tsx?|jsx?)$",
      }),
    ],
    env: inheritedEnv({ NODE_ENV: "production" }),
    stderr: "pipe",
  })

  try {
    await client.connect(transport)
    const result = await client.callTool({ name: "test_results", arguments: { wait_for_completion: true } })
    const content = result.content as Array<{ type: string, text: string }>
    expect(content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining('"failed":0'),
    })
  } finally {
    await client.close()
    rmSync(cwd, { recursive: true, force: true })
  }
})
