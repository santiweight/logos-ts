import { createRequire } from "node:module"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"

const require = createRequire(import.meta.url)

export type WorkspaceKind = "code"

export type StoredGoalLifecycle =
  | {
      stage: "initializing"
      state: "creating_goal" | "creating_workspace" | "creating_instance" | "starting_session"
    }
  | {
      stage: "impl"
      state: "agent_running" | "agent_finished" | "ready_to_merge" | "impl_blocked" | "impl_failed"
    }
  | {
      stage: "merging"
      state: "queued" | "rebasing" | "resolving_conflicts" | "running_tests" | "repairing_tests" | "promoting_instance" | "merge_blocked" | "merge_failed"
    }
  | {
      stage: "merged"
      state: "complete"
    }

export interface StoredGoalMergePolicy {
  autoMerge: boolean
}

export interface StoredGoal {
  id: string
  workspaceId?: string
  text: string
  label: string
  target: string
  mode: WorkspaceKind
  createdAt: number
  storyId?: string | null
  selector?: string | null
  component?: string | null
  appPath?: string | null
  runTargetId?: string | null
  screenshotDataUrl?: string | null
  status: "pending" | "running" | "done" | "error"
  lifecycle: StoredGoalLifecycle
  mergePolicy: StoredGoalMergePolicy
  baseInstanceId?: string | null
  workingInstanceId?: string | null
  mergedInstanceId?: string | null
  sessionId?: string | null
}

export interface StoredWorkspaceInstance {
  id: string
  workspaceId: string
  materializedRoot: string
  mutability: "writable" | "immutable"
  createdAt: number
  index: unknown
}

export interface StoredWorkspacePublication {
  branchName: string
  remote: string
  commit: string
  changed: boolean
  pullRequest?: {
    number: number | null
    url: string
    created: boolean
  }
  updatedAt: number
}

export type StoredWorkspaceInitializationStatus = "initializing" | "ready" | "error"
export type StoredWorkspaceInitializationStepStatus = "pending" | "running" | "done" | "error"

export interface StoredWorkspaceInitializationStep {
  id: "materialize" | "install_dependencies" | "story_snapshots" | "commit_baseline" | "index"
  label: string
  status: StoredWorkspaceInitializationStepStatus
  detail?: string
  error?: string
}

export interface StoredWorkspaceInitialization {
  status: StoredWorkspaceInitializationStatus
  updatedAt: number
  steps: StoredWorkspaceInitializationStep[]
}

export type StoredWorkspaceType = "local" | "remote"

export interface StoredWorkspaceTracking {
  remote: string
  branch: string
}

export interface StoredWorkspaceRecord {
  id: string
  name: string
  kind: WorkspaceKind
  type: StoredWorkspaceType
  parentId: string | null
  createdAt: number
  baseInstanceId: string
  activeInstanceId: string
  goals: StoredGoal[]
  instances: Record<string, StoredWorkspaceInstance>
  initialization?: StoredWorkspaceInitialization
  publication?: StoredWorkspacePublication
  tracking?: StoredWorkspaceTracking
}

export type WorkspacePolicyEventType =
  | "goal_rejected"

export interface StoredWorkspacePolicyEvent {
  seq: number
  type: WorkspacePolicyEventType
  createdAt: number
  workspaceId: string
  goalId?: string
  message: string
  details?: Record<string, unknown>
}

export interface StoredStorybookEntry {
  id: string
  pid: number
  port: number
  url: string
  cwd: string
  startedAt: number
}

export type StoredStorybookStatus = "starting" | "ready" | "failed"

export interface StoredStorybookState {
  id: string
  status: StoredStorybookStatus
  startedAt: number
  updatedAt: number
  logs: string[]
  error?: string
}

export interface StoredRunEntry {
  id: string
  workspaceId: string
  targetId: string
  framework: "vite" | "next"
  pid: number
  port: number
  url: string
  cwd: string
  startedAt: number
}

export type StoredRunStatus = "starting" | "ready" | "failed"

export interface StoredRunState {
  id: string
  workspaceId: string
  targetId: string
  status: StoredRunStatus
  startedAt: number
  updatedAt: number
  logs: string[]
  error?: string
}

export class LogosRuntimeStore {
  private db: import("node:sqlite").DatabaseSync

  constructor(dbPath: string) {
    const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite")
    mkdirSync(dirname(dbPath), { recursive: true })
    this.db = new DatabaseSync(dbPath)
    this.configureConnection()
    this.ensureSchema()
  }

  get database(): import("node:sqlite").DatabaseSync {
    return this.db
  }

  private configureConnection(): void {
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
    `)
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        parent_id TEXT,
        created_at INTEGER NOT NULL,
        base_instance_id TEXT NOT NULL,
        active_instance_id TEXT NOT NULL,
        initialization_json TEXT,
        publication_json TEXT
      );
      CREATE TABLE IF NOT EXISTS workspace_instances (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        materialized_root TEXT NOT NULL,
        mutability TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        index_json TEXT NOT NULL,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_workspace_instances_workspace ON workspace_instances(workspace_id);
      CREATE TABLE IF NOT EXISTS goals (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        position_index INTEGER NOT NULL,
        text TEXT NOT NULL,
        label TEXT NOT NULL,
        target TEXT NOT NULL,
        mode TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        story_id TEXT,
        selector TEXT,
        component TEXT,
        app_path TEXT,
        run_target_id TEXT,
        status TEXT NOT NULL,
        lifecycle_json TEXT,
        auto_merge INTEGER NOT NULL DEFAULT 1,
        working_instance_id TEXT,
        merged_instance_id TEXT,
        session_id TEXT,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_goals_workspace ON goals(workspace_id, position_index);
      CREATE TABLE IF NOT EXISTS workspace_policy_events (
        seq INTEGER PRIMARY KEY,
        type TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        workspace_id TEXT NOT NULL,
        goal_id TEXT,
        message TEXT NOT NULL,
        details_json TEXT,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_policy_events_workspace ON workspace_policy_events(workspace_id, seq);
      CREATE TABLE IF NOT EXISTS storybooks (
        id TEXT PRIMARY KEY,
        pid INTEGER NOT NULL,
        port INTEGER NOT NULL,
        url TEXT NOT NULL,
        cwd TEXT NOT NULL,
        started_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS storybook_states (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        logs_json TEXT NOT NULL,
        error TEXT
      );
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        target_id TEXT NOT NULL,
        framework TEXT NOT NULL DEFAULT 'vite',
        pid INTEGER NOT NULL,
        port INTEGER NOT NULL,
        url TEXT NOT NULL,
        cwd TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        UNIQUE(workspace_id, target_id)
      );
      CREATE INDEX IF NOT EXISTS idx_runs_workspace ON runs(workspace_id);
      CREATE TABLE IF NOT EXISTS run_states (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        target_id TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        logs_json TEXT NOT NULL,
        error TEXT,
        UNIQUE(workspace_id, target_id)
      );
      CREATE INDEX IF NOT EXISTS idx_run_states_workspace ON run_states(workspace_id);
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        goal_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS session_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON UPDATE CASCADE ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        type TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_session ON session_events(session_id, seq);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_goal ON sessions(goal_id);
    `)
    this.addColumnIfMissing("workspaces", "publication_json", "TEXT")
    this.addColumnIfMissing("workspaces", "initialization_json", "TEXT")
    this.addColumnIfMissing("workspaces", "workspace_type", "TEXT NOT NULL DEFAULT 'local'")
    this.addColumnIfMissing("workspaces", "tracking_json", "TEXT")
    this.addColumnIfMissing("goals", "lifecycle_json", "TEXT")
    this.addColumnIfMissing("goals", "auto_merge", "INTEGER NOT NULL DEFAULT 1")
    this.addColumnIfMissing("goals", "base_instance_id", "TEXT")
    this.addColumnIfMissing("goals", "working_instance_id", "TEXT")
    this.addColumnIfMissing("goals", "merged_instance_id", "TEXT")
    this.addColumnIfMissing("goals", "app_path", "TEXT")
    this.addColumnIfMissing("goals", "run_target_id", "TEXT")
    this.addColumnIfMissing("goals", "screenshot_data_url", "TEXT")
    this.addColumnIfMissing("runs", "framework", "TEXT NOT NULL DEFAULT 'vite'")
    this.migrateStorybookServiceTables()
  }

  private migrateStorybookServiceTables(): void {
    this.rebuildTableWithoutForeignKeys(
      "storybooks",
      `CREATE TABLE storybooks (
        id TEXT PRIMARY KEY,
        pid INTEGER NOT NULL,
        port INTEGER NOT NULL,
        url TEXT NOT NULL,
        cwd TEXT NOT NULL,
        started_at INTEGER NOT NULL
      )`,
      "id, pid, port, url, cwd, started_at",
    )
    this.rebuildTableWithoutForeignKeys(
      "storybook_states",
      `CREATE TABLE storybook_states (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        logs_json TEXT NOT NULL,
        error TEXT
      )`,
      "id, status, started_at, updated_at, logs_json, error",
    )
  }

  private rebuildTableWithoutForeignKeys(table: string, createSql: string, columns: string): void {
    const foreignKeys = this.db.prepare(`PRAGMA foreign_key_list(${table})`).all()
    if (foreignKeys.length === 0) return
    const oldTable = `__old_${table}_fk`
    this.transaction(() => {
      this.db.exec(`DROP TABLE IF EXISTS ${oldTable}`)
      this.db.exec(`ALTER TABLE ${table} RENAME TO ${oldTable}`)
      this.db.exec(createSql)
      this.db.exec(`INSERT INTO ${table} (${columns}) SELECT ${columns} FROM ${oldTable}`)
      this.db.exec(`DROP TABLE ${oldTable}`)
    })
  }

  private addColumnIfMissing(table: string, column: string, definition: string): void {
    const rows = this.db.prepare(`PRAGMA table_info(${table})`).all() as { name?: string }[]
    if (rows.some((row) => row.name === column)) return
    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }

  listWorkspaces(): StoredWorkspaceRecord[] {
    const rows = this.db.prepare(`SELECT * FROM workspaces ORDER BY created_at, id`).all() as Record<string, unknown>[]
    return rows.map((row) => this.loadWorkspace(String(row["id"]))).filter((ws): ws is StoredWorkspaceRecord => ws !== null)
  }

  loadWorkspace(id: string): StoredWorkspaceRecord | null {
    const row = this.db.prepare(`SELECT * FROM workspaces WHERE id = ?`).get(id) as Record<string, unknown> | undefined
    if (!row) return null
    const goals = this.db.prepare(
      `SELECT * FROM goals WHERE workspace_id = ? ORDER BY position_index`
    ).all(id) as Record<string, unknown>[]
    const instances = this.db.prepare(
      `SELECT * FROM workspace_instances WHERE workspace_id = ? ORDER BY created_at, id`
    ).all(id) as Record<string, unknown>[]
    const wsType = (row["workspace_type"] as string | undefined) === "remote" ? "remote" as const : "local" as const
    const workspace: StoredWorkspaceRecord = {
      id: row["id"] as string,
      name: row["name"] as string,
      kind: "code",
      type: wsType,
      parentId: nullableString(row["parent_id"]),
      createdAt: row["created_at"] as number,
      baseInstanceId: row["base_instance_id"] as string,
      activeInstanceId: row["active_instance_id"] as string,
      goals: goals.map(mapGoal),
      instances: Object.fromEntries(instances.map((inst) => {
        const mapped = mapInstance(inst)
        return [mapped.id, mapped]
      })),
    }
    const initialization = parseInitialization(row["initialization_json"])
    if (initialization) workspace.initialization = initialization
    const publication = parsePublication(row["publication_json"])
    if (publication) workspace.publication = publication
    const tracking = parseTracking(row["tracking_json"])
    if (tracking) workspace.tracking = tracking
    return workspace
  }

  saveWorkspace(ws: StoredWorkspaceRecord): void {
    this.transaction(() => {
      this.db.prepare(`
        INSERT INTO workspaces (id, name, kind, parent_id, created_at, base_instance_id, active_instance_id, initialization_json, publication_json, workspace_type, tracking_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          kind = excluded.kind,
          parent_id = excluded.parent_id,
          created_at = excluded.created_at,
          base_instance_id = excluded.base_instance_id,
          active_instance_id = excluded.active_instance_id,
          initialization_json = excluded.initialization_json,
          publication_json = excluded.publication_json,
          workspace_type = excluded.workspace_type,
          tracking_json = excluded.tracking_json
      `).run(
        ws.id,
        ws.name,
        ws.kind,
        ws.parentId,
        ws.createdAt,
        ws.baseInstanceId,
        ws.activeInstanceId,
        ws.initialization ? JSON.stringify(ws.initialization) : null,
        ws.publication ? JSON.stringify(ws.publication) : null,
        ws.type,
        ws.tracking ? JSON.stringify(ws.tracking) : null,
      )

      this.db.prepare(`DELETE FROM workspace_instances WHERE workspace_id = ?`).run(ws.id)
      for (const inst of Object.values(ws.instances)) {
        this.db.prepare(`
          INSERT INTO workspace_instances (id, workspace_id, materialized_root, mutability, created_at, index_json)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(inst.id, ws.id, inst.materializedRoot, inst.mutability, inst.createdAt, JSON.stringify(inst.index))
      }

      this.db.prepare(`DELETE FROM goals WHERE workspace_id = ?`).run(ws.id)
      ws.goals.forEach((goal, position) => {
        this.db.prepare(`
          INSERT INTO goals (
            id, workspace_id, position_index, text, label, target, mode, created_at,
            story_id, selector, component, app_path, run_target_id, screenshot_data_url, status, lifecycle_json, auto_merge,
            base_instance_id, working_instance_id, merged_instance_id, session_id
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          goal.id,
          ws.id,
          position,
          goal.text,
          goal.label,
          goal.target,
          goal.mode,
          goal.createdAt,
          goal.storyId ?? null,
          goal.selector ?? null,
          goal.component ?? null,
          goal.appPath ?? null,
          goal.runTargetId ?? null,
          goal.screenshotDataUrl ?? null,
          goal.status,
          JSON.stringify(goal.lifecycle),
          goal.mergePolicy.autoMerge ? 1 : 0,
          goal.baseInstanceId ?? null,
          goal.workingInstanceId ?? null,
          goal.mergedInstanceId ?? null,
          goal.sessionId ?? null,
        )
      })
    })
  }

  deleteWorkspace(id: string): void {
    this.transaction(() => {
      this.db.prepare(`DELETE FROM goals WHERE workspace_id = ?`).run(id)
      this.db.prepare(`DELETE FROM workspace_instances WHERE workspace_id = ?`).run(id)
      this.db.prepare(`DELETE FROM storybooks WHERE id = ?`).run(id)
      this.db.prepare(`DELETE FROM storybook_states WHERE id = ?`).run(id)
      this.db.prepare(`DELETE FROM runs WHERE workspace_id = ?`).run(id)
      this.db.prepare(`DELETE FROM run_states WHERE workspace_id = ?`).run(id)
      this.db.prepare(`DELETE FROM workspace_policy_events WHERE workspace_id = ?`).run(id)
      this.db.prepare(`DELETE FROM workspaces WHERE id = ?`).run(id)
    })
  }

  deleteAllWorkspaces(): void {
    this.transaction(() => {
      this.db.prepare(`DELETE FROM goals`).run()
      this.db.prepare(`DELETE FROM workspace_instances`).run()
      this.db.prepare(`DELETE FROM storybooks`).run()
      this.db.prepare(`DELETE FROM storybook_states`).run()
      this.db.prepare(`DELETE FROM runs`).run()
      this.db.prepare(`DELETE FROM run_states`).run()
      this.db.prepare(`DELETE FROM workspace_policy_events`).run()
      this.db.prepare(`DELETE FROM workspaces`).run()
    })
  }

  addPolicyEvent(event: Omit<StoredWorkspacePolicyEvent, "seq" | "createdAt">): StoredWorkspacePolicyEvent {
    const row = this.db.prepare(
      `SELECT COALESCE(MAX(seq), -1) + 1 AS next_seq FROM workspace_policy_events`
    ).get() as { next_seq: number }
    const stored: StoredWorkspacePolicyEvent = { ...event, seq: row.next_seq, createdAt: Date.now() }
    this.db.prepare(`
      INSERT INTO workspace_policy_events (seq, type, created_at, workspace_id, goal_id, message, details_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      stored.seq,
      stored.type,
      stored.createdAt,
      stored.workspaceId,
      stored.goalId ?? null,
      stored.message,
      stored.details ? JSON.stringify(stored.details) : null,
    )
    return stored
  }

  listPolicyEvents(opts?: { workspaceId?: string; limit?: number }): StoredWorkspacePolicyEvent[] {
    const rows = this.db.prepare(
      `SELECT * FROM workspace_policy_events ORDER BY seq`
    ).all() as Record<string, unknown>[]
    const events = rows.map(mapPolicyEvent)
    const filtered = opts?.workspaceId
      ? events.filter((event) => (
          event.workspaceId === opts.workspaceId ||
          event.details?.["sourceWorkspaceId"] === opts.workspaceId ||
          event.details?.["targetWorkspaceId"] === opts.workspaceId
        ))
      : events
    return filtered.slice(-(opts?.limit ?? 200))
  }

  deleteAllPolicyEvents(): void {
    this.db.prepare(`DELETE FROM workspace_policy_events`).run()
  }

  listStorybooks(): Record<string, StoredStorybookEntry> {
    const rows = this.db.prepare(`SELECT * FROM storybooks ORDER BY id`).all() as Record<string, unknown>[]
    return Object.fromEntries(rows.map((row) => {
      const entry = mapStorybook(row)
      return [entry.id, entry]
    }))
  }

  saveStorybooks(entries: Record<string, StoredStorybookEntry>): void {
    this.transaction(() => {
      this.db.prepare(`DELETE FROM storybooks`).run()
      for (const entry of Object.values(entries)) {
        this.db.prepare(`
          INSERT INTO storybooks (id, pid, port, url, cwd, started_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(entry.id, entry.pid, entry.port, entry.url, entry.cwd, entry.startedAt)
      }
    })
  }

  deleteAllStorybooks(): void {
    this.db.prepare(`DELETE FROM storybooks`).run()
  }

  listStorybookStates(): Record<string, StoredStorybookState> {
    const rows = this.db.prepare(`SELECT * FROM storybook_states ORDER BY id`).all() as Record<string, unknown>[]
    return Object.fromEntries(rows.map((row) => {
      const state = mapStorybookState(row)
      return [state.id, state]
    }))
  }

  saveStorybookState(state: StoredStorybookState): void {
    this.db.prepare(`
      INSERT INTO storybook_states (id, status, started_at, updated_at, logs_json, error)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        started_at = excluded.started_at,
        updated_at = excluded.updated_at,
        logs_json = excluded.logs_json,
        error = excluded.error
    `).run(
      state.id,
      state.status,
      state.startedAt,
      state.updatedAt,
      JSON.stringify(state.logs),
      state.error ?? null,
    )
  }

  deleteStorybookState(id: string): void {
    this.db.prepare(`DELETE FROM storybook_states WHERE id = ?`).run(id)
  }

  deleteAllStorybookStates(): void {
    this.db.prepare(`DELETE FROM storybook_states`).run()
  }

  listRuns(): Record<string, StoredRunEntry> {
    const rows = this.db.prepare(`SELECT * FROM runs ORDER BY workspace_id, target_id`).all() as Record<string, unknown>[]
    return Object.fromEntries(rows.map((row) => {
      const entry = mapRun(row)
      return [entry.id, entry]
    }))
  }

  saveRuns(entries: Record<string, StoredRunEntry>): void {
    const validWs = new Set(
      (this.db.prepare(`SELECT id FROM workspaces`).all() as { id: string }[]).map((r) => r.id),
    )
    this.transaction(() => {
      this.db.prepare(`DELETE FROM runs`).run()
      for (const entry of Object.values(entries)) {
        if (!validWs.has(entry.workspaceId)) continue
        this.db.prepare(`
          INSERT INTO runs (id, workspace_id, target_id, framework, pid, port, url, cwd, started_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          entry.id,
          entry.workspaceId,
          entry.targetId,
          entry.framework,
          entry.pid,
          entry.port,
          entry.url,
          entry.cwd,
          entry.startedAt,
        )
      }
    })
  }

  deleteAllRuns(): void {
    this.db.prepare(`DELETE FROM runs`).run()
  }

  listRunStates(): Record<string, StoredRunState> {
    const rows = this.db.prepare(`SELECT * FROM run_states ORDER BY workspace_id, target_id`).all() as Record<string, unknown>[]
    return Object.fromEntries(rows.map((row) => {
      const state = mapRunState(row)
      return [state.id, state]
    }))
  }

  saveRunState(state: StoredRunState): void {
    const ws = this.db.prepare(`SELECT 1 FROM workspaces WHERE id = ?`).get(state.workspaceId)
    if (!ws) return
    this.db.prepare(`
      INSERT INTO run_states (id, workspace_id, target_id, status, started_at, updated_at, logs_json, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        workspace_id = excluded.workspace_id,
        target_id = excluded.target_id,
        status = excluded.status,
        started_at = excluded.started_at,
        updated_at = excluded.updated_at,
        logs_json = excluded.logs_json,
        error = excluded.error
    `).run(
      state.id,
      state.workspaceId,
      state.targetId,
      state.status,
      state.startedAt,
      state.updatedAt,
      JSON.stringify(state.logs),
      state.error ?? null,
    )
  }

  deleteRunState(id: string): void {
    this.db.prepare(`DELETE FROM run_states WHERE id = ?`).run(id)
  }

  deleteAllRunStates(): void {
    this.db.prepare(`DELETE FROM run_states`).run()
  }

  close(): void {
    this.db.close()
  }

  private transaction(fn: () => void): void {
    this.db.exec("BEGIN")
    try {
      fn()
      this.db.exec("COMMIT")
    } catch (e) {
      this.db.exec("ROLLBACK")
      throw e
    }
  }
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function parseTracking(value: unknown): StoredWorkspaceTracking | undefined {
  if (typeof value !== "string" || !value) return undefined
  try {
    const parsed = JSON.parse(value) as StoredWorkspaceTracking
    if (!parsed.remote || !parsed.branch) return undefined
    return parsed
  } catch {
    return undefined
  }
}

function parsePublication(value: unknown): StoredWorkspacePublication | undefined {
  if (typeof value !== "string" || !value) return undefined
  try {
    const parsed = JSON.parse(value) as StoredWorkspacePublication
    if (!parsed.branchName || !parsed.remote || !parsed.commit) return undefined
    return parsed
  } catch {
    return undefined
  }
}

function parseInitialization(value: unknown): StoredWorkspaceInitialization | undefined {
  if (typeof value !== "string" || !value) return undefined
  try {
    const parsed = JSON.parse(value) as Partial<StoredWorkspaceInitialization>
    if (
      parsed.status !== "initializing" &&
      parsed.status !== "ready" &&
      parsed.status !== "error"
    ) return undefined
    if (typeof parsed.updatedAt !== "number") return undefined
    if (!Array.isArray(parsed.steps)) return undefined
    const steps = parsed.steps.flatMap((step): StoredWorkspaceInitializationStep[] => {
      if (!step || typeof step !== "object") return []
      const candidate = step as Partial<StoredWorkspaceInitializationStep>
      if (
        candidate.id !== "materialize" &&
        candidate.id !== "install_dependencies" &&
        candidate.id !== "story_snapshots" &&
        candidate.id !== "commit_baseline" &&
        candidate.id !== "index"
      ) return []
      if (typeof candidate.label !== "string") return []
      if (
        candidate.status !== "pending" &&
        candidate.status !== "running" &&
        candidate.status !== "done" &&
        candidate.status !== "error"
      ) return []
      const out: StoredWorkspaceInitializationStep = {
        id: candidate.id,
        label: candidate.label,
        status: candidate.status,
      }
      if (typeof candidate.detail === "string") out.detail = candidate.detail
      if (typeof candidate.error === "string") out.error = candidate.error
      return [out]
    })
    return { status: parsed.status, updatedAt: parsed.updatedAt, steps }
  } catch {
    return undefined
  }
}

function defaultGoalLifecycle(status: StoredGoal["status"]): StoredGoalLifecycle {
  switch (status) {
    case "running": return { stage: "impl", state: "agent_running" }
    case "done": return { stage: "merged", state: "complete" }
    case "error": return { stage: "impl", state: "impl_failed" }
    case "pending":
    default: return { stage: "initializing", state: "creating_goal" }
  }
}

function parseGoalLifecycle(value: unknown, status: StoredGoal["status"]): StoredGoalLifecycle {
  if (typeof value !== "string" || !value) return defaultGoalLifecycle(status)
  try {
    const parsed = JSON.parse(value) as Partial<StoredGoalLifecycle>
    if (parsed.stage === "initializing" && (
      parsed.state === "creating_goal" ||
      parsed.state === "creating_workspace" ||
      parsed.state === "creating_instance" ||
      parsed.state === "starting_session"
    )) return parsed as StoredGoalLifecycle
    if (parsed.stage === "impl" && (
      parsed.state === "agent_running" ||
      parsed.state === "agent_finished" ||
      parsed.state === "ready_to_merge" ||
      parsed.state === "impl_blocked" ||
      parsed.state === "impl_failed"
    )) return parsed as StoredGoalLifecycle
    if (parsed.stage === "merging" && (
      parsed.state === "queued" ||
      parsed.state === "rebasing" ||
      parsed.state === "resolving_conflicts" ||
      parsed.state === "running_tests" ||
      parsed.state === "repairing_tests" ||
      parsed.state === "promoting_instance" ||
      parsed.state === "merge_blocked" ||
      parsed.state === "merge_failed"
    )) return parsed as StoredGoalLifecycle
    if (parsed.stage === "merged" && parsed.state === "complete") return parsed as StoredGoalLifecycle
  } catch {}
  return defaultGoalLifecycle(status)
}

function mapGoal(row: Record<string, unknown>): StoredGoal {
  const status = row["status"] as StoredGoal["status"]
  return {
    id: row["id"] as string,
    workspaceId: row["workspace_id"] as string,
    text: row["text"] as string,
    label: row["label"] as string,
    target: row["target"] as string,
    mode: "code",
    createdAt: row["created_at"] as number,
    storyId: nullableString(row["story_id"]),
    selector: nullableString(row["selector"]),
    component: nullableString(row["component"]),
    appPath: nullableString(row["app_path"]),
    runTargetId: nullableString(row["run_target_id"]),
    screenshotDataUrl: nullableString(row["screenshot_data_url"]),
    status,
    lifecycle: parseGoalLifecycle(row["lifecycle_json"], status),
    mergePolicy: { autoMerge: row["auto_merge"] !== 0 },
    baseInstanceId: nullableString(row["base_instance_id"]),
    workingInstanceId: nullableString(row["working_instance_id"]),
    mergedInstanceId: nullableString(row["merged_instance_id"]),
    sessionId: nullableString(row["session_id"]),
  }
}

function mapInstance(row: Record<string, unknown>): StoredWorkspaceInstance {
  return {
    id: row["id"] as string,
    workspaceId: row["workspace_id"] as string,
    materializedRoot: row["materialized_root"] as string,
    mutability: row["mutability"] === "immutable" ? "immutable" : "writable",
    createdAt: row["created_at"] as number,
    index: JSON.parse(row["index_json"] as string),
  }
}

function mapPolicyEvent(row: Record<string, unknown>): StoredWorkspacePolicyEvent {
  const details = row["details_json"] == null ? undefined : JSON.parse(row["details_json"] as string)
  const event: StoredWorkspacePolicyEvent = {
    seq: row["seq"] as number,
    type: row["type"] as WorkspacePolicyEventType,
    createdAt: row["created_at"] as number,
    workspaceId: row["workspace_id"] as string,
    message: row["message"] as string,
  }
  const goalId = nullableString(row["goal_id"])
  if (goalId) event.goalId = goalId
  if (details) event.details = details
  return event
}

function mapStorybook(row: Record<string, unknown>): StoredStorybookEntry {
  return {
    id: row["id"] as string,
    pid: row["pid"] as number,
    port: row["port"] as number,
    url: row["url"] as string,
    cwd: row["cwd"] as string,
    startedAt: row["started_at"] as number,
  }
}

function mapStorybookState(row: Record<string, unknown>): StoredStorybookState {
  const state: StoredStorybookState = {
    id: row["id"] as string,
    status: row["status"] as StoredStorybookStatus,
    startedAt: row["started_at"] as number,
    updatedAt: row["updated_at"] as number,
    logs: JSON.parse(row["logs_json"] as string),
  }
  const error = nullableString(row["error"])
  if (error) state.error = error
  return state
}

function mapRun(row: Record<string, unknown>): StoredRunEntry {
  return {
    id: row["id"] as string,
    workspaceId: row["workspace_id"] as string,
    targetId: row["target_id"] as string,
    framework: row["framework"] as "vite" | "next",
    pid: row["pid"] as number,
    port: row["port"] as number,
    url: row["url"] as string,
    cwd: row["cwd"] as string,
    startedAt: row["started_at"] as number,
  }
}

function mapRunState(row: Record<string, unknown>): StoredRunState {
  const state: StoredRunState = {
    id: row["id"] as string,
    workspaceId: row["workspace_id"] as string,
    targetId: row["target_id"] as string,
    status: row["status"] as StoredRunStatus,
    startedAt: row["started_at"] as number,
    updatedAt: row["updated_at"] as number,
    logs: JSON.parse(row["logs_json"] as string),
  }
  const error = nullableString(row["error"])
  if (error) state.error = error
  return state
}
