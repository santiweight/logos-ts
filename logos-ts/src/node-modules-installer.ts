import { execFileSync } from "node:child_process"
import { existsSync, lstatSync, readdirSync, statSync, unlinkSync } from "node:fs"
import { basename, join } from "node:path"

export interface NodeModulesInstallResult {
  nodeModulesPath: string
  alreadyPresent: boolean
}

export class NodeModulesInstaller {
  ensureFor(packageDir: string): NodeModulesInstallResult {
    const nodeModulesPath = join(packageDir, "node_modules")
    if (!existsSync(join(packageDir, "package.json"))) {
      return { nodeModulesPath, alreadyPresent: false }
    }

    const alreadyPresent = this.hasLocalNodeModules(nodeModulesPath)
    console.log(`[logos] pnpm install${alreadyPresent ? " present" : ""}: ${basename(packageDir)}…`)
    this.removeSymlinkedNodeModules(nodeModulesPath)
    execFileSync("pnpm", this.installArgsFor(packageDir), {
      cwd: packageDir,
      stdio: "inherit",
      env: { ...process.env, NODE_ENV: "" },
    })
    return { nodeModulesPath, alreadyPresent }
  }

  private installArgsFor(packageDir: string): string[] {
    const args = existsSync(join(packageDir, "pnpm-lock.yaml"))
      ? ["install", "--frozen-lockfile"]
      : ["install"]
    return [...args, "--ignore-scripts"]
  }

  private hasLocalNodeModules(nodeModulesPath: string): boolean {
    try {
      const stat = lstatSync(nodeModulesPath)
      return stat.isDirectory() && !stat.isSymbolicLink()
    } catch {
      return false
    }
  }

  private removeSymlinkedNodeModules(nodeModulesPath: string): void {
    try {
      if (lstatSync(nodeModulesPath).isSymbolicLink()) {
        unlinkSync(nodeModulesPath)
      }
    } catch {
      // Missing node_modules is fine; pnpm will create it.
    }
  }
}

export function findPackageDirs(root: string): string[] {
  const dirs: string[] = []
  const visit = (dir: string) => {
    if (existsSync(join(dir, "package.json"))) dirs.push(dir)
    for (const entry of safeReaddir(dir)) {
      if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue
      const sub = join(dir, entry)
      try {
        if (statSync(sub).isDirectory()) visit(sub)
      } catch { /* skip */ }
    }
  }
  visit(root)
  return dirs
}

function safeReaddir(dir: string): string[] {
  try { return readdirSync(dir) } catch { return [] }
}
