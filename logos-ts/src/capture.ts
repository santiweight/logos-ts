import { execFileSync } from "node:child_process"
import { resolve, join } from "node:path"

export function updateSnapshots(root: string): void {
  const absRoot = resolve(root)
  const vitest = join(absRoot, "frontend/node_modules/.bin/vitest")
  execFileSync(vitest, ["run", "--update", "frontend/stories.test.tsx"], {
    cwd: absRoot,
    stdio: ["ignore", "ignore", "ignore"],
  })
}

// CLI: tsx src/capture.ts <root>
const [, , root = "demos/hn-jobs"] = process.argv
updateSnapshots(root)
console.log("updated story snapshots")
