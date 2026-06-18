import { cpSync, existsSync, mkdirSync, readdirSync, symlinkSync } from "node:fs"
import { execFile, execFileSync } from "node:child_process"
import { basename, dirname, join, relative, resolve, sep } from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export interface CodeWorkspaceInstance {
  id: string
  workspaceId: string
  materializedRoot: string
  mutability: "writable" | "immutable"
  createdAt: number
  index: unknown
}

export type RebaseInstanceResult =
  | { status: "clean"; instance: CodeWorkspaceInstance; message: string }
  | { status: "conflicts"; instance: CodeWorkspaceInstance; message: string; suggestedCommands: string[]; context: RebaseConflictContext }
  | { status: "error"; instance: CodeWorkspaceInstance; message: string }

export interface RebaseConflictContext {
  status: string
  unmergedFiles: string[]
  generatedSnapshotFiles: string[]
  conflictedFiles: { path: string; conflictMarkers: number }[]
}

export interface WorkspaceCodeServiceOptions {
  runsDir: string
  projectRoot: string
  nodeModulesDirs: string[]
}

function isSubpath(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child))
  return rel === "" || (!!rel && !rel.startsWith("..") && !rel.startsWith("/"))
}

export class WorkspaceCodeService {
  private locks = new Map<string, Promise<void>>()

  constructor(private opts: WorkspaceCodeServiceOptions) {}

  createInstance(workspaceId: string, sourceRoot: string, index: unknown): CodeWorkspaceInstance {
    const id = `inst-${Date.now()}-${Math.round(Math.random() * 1e6)}`
    const materializedRoot = this.createMaterializedRoot(id, sourceRoot)
    this.ensureRepo(materializedRoot)
    return {
      id,
      workspaceId,
      materializedRoot,
      mutability: "writable",
      createdAt: Date.now(),
      index,
    }
  }

  async commitWorkspaceChanges(instance: CodeWorkspaceInstance, message: string): Promise<boolean> {
    this.ensureRepo(instance.materializedRoot)
    return this.commitWorkingTree(instance.materializedRoot, message)
  }

  async withWorkspaceLock<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(workspaceId) ?? Promise.resolve()
    let release!: () => void
    const current = previous.catch(() => undefined).then(() => new Promise<void>((resolveRelease) => {
      release = resolveRelease
    }))
    this.locks.set(workspaceId, current)

    await previous.catch(() => undefined)
    try {
      return await fn()
    } finally {
      release()
      if (this.locks.get(workspaceId) === current) this.locks.delete(workspaceId)
    }
  }

  async rebaseInstance(input: {
    workspaceId: string
    instance: CodeWorkspaceInstance
    onto: CodeWorkspaceInstance
  }): Promise<RebaseInstanceResult> {
    const { instance, onto } = input
    this.ensureRepo(instance.materializedRoot)
    this.ensureRepo(onto.materializedRoot)
    await this.commitWorkingTree(instance.materializedRoot, "Logos agent changes")
    await this.commitWorkingTree(onto.materializedRoot, "Logos workspace changes")

    if (instance.id === onto.id) {
      return { status: "clean", instance, message: "workspace instance is already active" }
    }

    const ontoRef = `refs/remotes/logos/onto-${Date.now()}-${Math.round(Math.random() * 1e6)}`
    await this.runGit(instance.materializedRoot, ["fetch", "--force", onto.materializedRoot, `HEAD:${ontoRef}`])
    const rebase = await this.runGitAllowFailure(instance.materializedRoot, ["rebase", ontoRef])
    if (rebase.code === 0) {
      return { status: "clean", instance, message: "workspace instance rebased cleanly" }
    }

    const autoResolved = await this.autoResolveGeneratedSnapshotConflicts(instance.materializedRoot)
    if (autoResolved.status === "clean") {
      return { status: "clean", instance, message: autoResolved.message }
    }

    if (!await this.hasRebaseConflictState(instance.materializedRoot)) {
      return {
        status: "error",
        instance,
        message: (rebase.output.trim() || "workspace instance rebase failed without conflicts"),
      }
    }

    const context = await this.rebaseConflictContext(instance.materializedRoot)
    return {
      status: "conflicts",
      instance,
      message: ([rebase.output.trim(), autoResolved.message].filter(Boolean).join("\n\n") || "workspace instance has rebase conflicts"),
      suggestedCommands: [
        "!git status",
        "!git diff --name-only --diff-filter=U",
        "!git add <resolved-files>",
        "!GIT_EDITOR=true git rebase --continue",
      ],
      context,
    }
  }

  private createMaterializedRoot(instanceId: string, sourceRoot = this.opts.projectRoot): string {
    mkdirSync(this.opts.runsDir, { recursive: true })
    const dir = resolve(this.opts.runsDir, instanceId)
    if (!existsSync(dir)) {
      const copyGit = existsSync(join(sourceRoot, ".git")) && isSubpath(this.opts.runsDir, sourceRoot)
      cpSync(sourceRoot, dir, {
        recursive: true,
        filter: (sourcePath) => {
          const name = basename(sourcePath)
          if (name === ".git") return copyGit
          return ![
            "node_modules",
            ".workspaces",
            ".logos",
            ".logos_cache",
            ".vite-logos",
            "dist",
          ].includes(name)
        },
      })
      for (const nmDir of this.opts.nodeModulesDirs) {
        this.symlinkDependencyDir(dir, this.opts.projectRoot, nmDir)
      }
      for (const dependencyDir of this.dependencyDirs(sourceRoot)) {
        this.symlinkDependencyDir(dir, sourceRoot, dependencyDir)
      }
    }
    return dir
  }

  private dependencyDirs(sourceRoot: string): string[] {
    const dirs: string[] = []
    const rootNodeModules = join(sourceRoot, "node_modules")
    if (existsSync(rootNodeModules)) dirs.push(rootNodeModules)

    for (const entry of readdirSync(sourceRoot)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue
      const nestedNodeModules = join(sourceRoot, entry, "node_modules")
      if (existsSync(nestedNodeModules)) dirs.push(nestedNodeModules)
    }

    return dirs
  }

  private symlinkDependencyDir(dir: string, baseRoot: string, dependencyDir: string): void {
    const rel = relative(baseRoot, dependencyDir)
    if (!rel || rel.startsWith(`..${sep}`) || rel === "..") return
    const target = join(dir, rel)
    try { mkdirSync(dirname(target), { recursive: true }) } catch { /* exists */ }
    try { symlinkSync(dependencyDir, target) } catch { /* exists */ }
  }

  private ensureRepo(root: string): void {
    if (!existsSync(join(root, ".git"))) {
      execFileSync("git", ["init"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    }
    this.configureRepo(root)
    try {
      execFileSync("git", ["rev-parse", "--verify", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
    } catch {
      this.gitAddWorkspace(root)
      execFileSync("git", ["commit", "--allow-empty", "-m", "Logos workspace baseline"], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      })
    }
  }

  private configureRepo(root: string): void {
    execFileSync("git", ["config", "user.email", "logos@example.com"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    execFileSync("git", ["config", "user.name", "Logos"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  }

  private async commitWorkingTree(root: string, message: string): Promise<boolean> {
    await this.gitAddWorkspaceAsync(root)
    const diff = await this.runGitAllowFailure(root, ["diff", "--cached", "--quiet"])
    if (diff.code === 0) return false
    if (diff.code !== 1) throw new Error(diff.output.trim() || "failed to inspect staged workspace changes")
    await this.runGit(root, ["commit", "-m", message])
    return true
  }

  private async runGit(root: string, args: string[]): Promise<string> {
    const { stdout, stderr } = await execFileAsync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 })
    return `${stdout}${stderr}`
  }

  private gitAddWorkspace(root: string): void {
    execFileSync("git", ["add", "-A", "--", ".", ":(exclude)node_modules", ":(exclude)*/node_modules", ":(exclude).logos_cache", ":(exclude).vite-logos", ":(exclude)dist"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
  }

  private async gitAddWorkspaceAsync(root: string): Promise<void> {
    await this.runGit(root, ["add", "-A", "--", ".", ":(exclude)node_modules", ":(exclude)*/node_modules", ":(exclude).logos_cache", ":(exclude).vite-logos", ":(exclude)dist"])
  }

  private async hasRebaseConflictState(root: string): Promise<boolean> {
    if (existsSync(join(root, ".git", "rebase-merge")) || existsSync(join(root, ".git", "rebase-apply"))) return true
    const unmerged = await this.runGitAllowFailure(root, ["diff", "--name-only", "--diff-filter=U"])
    return unmerged.code === 0 && unmerged.output.trim().length > 0
  }

  private async autoResolveGeneratedSnapshotConflicts(root: string): Promise<{ status: "clean" | "unresolved"; message: string }> {
    const unmerged = await this.unmergedFiles(root)
    if (unmerged.length === 0 || unmerged.some((file) => !this.isGeneratedSnapshot(file))) {
      return { status: "unresolved", message: "" }
    }

    const checkout = await this.runGitAllowFailure(root, ["checkout", "--theirs", "--", ...unmerged])
    if (checkout.code !== 0) {
      const fallback = await this.runGitAllowFailure(root, ["checkout", "--ours", "--", ...unmerged])
      if (fallback.code !== 0) return { status: "unresolved", message: `${checkout.output}\n${fallback.output}`.trim() }
    }

    await this.runGit(root, ["add", "--", ...unmerged])
    const continued = await this.runGitAllowFailure(root, ["-c", "core.editor=true", "rebase", "--continue"])
    const message = `Auto-resolved generated snapshot rebase conflicts: ${unmerged.join(", ")}`
    if (continued.code === 0) return { status: "clean", message }
    return { status: "unresolved", message: `${message}\n${continued.output}`.trim() }
  }

  private async rebaseConflictContext(root: string): Promise<RebaseConflictContext> {
    const status = await this.runGitAllowFailure(root, ["status", "--short"])
    const unmergedFiles = await this.unmergedFiles(root)
    const generatedSnapshotFiles = unmergedFiles.filter((file) => this.isGeneratedSnapshot(file))
    const conflictedFiles = await Promise.all(unmergedFiles.map(async (path) => ({
      path,
      conflictMarkers: await this.conflictMarkerCount(root, path),
    })))
    return {
      status: status.output.trim(),
      unmergedFiles,
      generatedSnapshotFiles,
      conflictedFiles,
    }
  }

  private async unmergedFiles(root: string): Promise<string[]> {
    const unmerged = await this.runGitAllowFailure(root, ["diff", "--name-only", "--diff-filter=U"])
    if (unmerged.code !== 0) return []
    return unmerged.output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  }

  private async conflictMarkerCount(root: string, path: string): Promise<number> {
    try {
      const { readFileSync } = await import("node:fs")
      const text = readFileSync(join(root, path), "utf8")
      return (text.match(/^<<<<<<< |^=======|^>>>>>>> /gm) ?? []).length
    } catch {
      return 0
    }
  }

  private isGeneratedSnapshot(path: string): boolean {
    const normalized = path.split(/[\\/]/).join(sep)
    return normalized.endsWith(".snap") && normalized.split(sep).includes("__snapshots__")
  }

  private async runGitAllowFailure(root: string, args: string[]): Promise<{ code: number; output: string }> {
    try {
      const output = await this.runGit(root, args)
      return { code: 0, output }
    } catch (error) {
      const e = error as { code?: number; stdout?: string; stderr?: string; message?: string }
      return {
        code: typeof e.code === "number" ? e.code : 1,
        output: `${e.stdout ?? ""}${e.stderr ?? ""}${e.message ?? ""}`,
      }
    }
  }
}
