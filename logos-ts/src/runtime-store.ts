import { createRequire } from "node:module"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"

const require = createRequire(import.meta.url)

export type WorkspaceKind = "code" | "arch"

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
  status: "pending" | "running" | "done" | "error"
  sessionId?: string | null
}

export interface StoredArcWsInstance {
  id: string
  workspaceId: string
  materializedRoot: string
  mutability: "writable" | "immutable"
  createdAt: number
  index: unknown
}

export interface StoredImplWsInstance {
  id: string
  workspaceId: string
  arcWsInstanceId: string | null
  materializedRoot: string
  mutability: "writable" | "immutable"
  createdAt: number
  index: unknown
  validation: unknown | null
}

export interface StoredWorkspaceRecord {
  id: string
  name: string
  kind: WorkspaceKind
  parentId: string | null
  createdAt: number
  baseArcWsInstanceId: string | null
  activeArcWsInstanceId: string | null
  goldenArcWsInstanceId: string | null
  baseImplWsInstanceId: string | null
  activeImplWsInstanceId: string | null
  goals: StoredGoal[]
  arcWsInstances: Record<string, StoredArcWsInstance>
  implWsInstances: Record<string, StoredImplWsInstance>
}

export type WorkspacePolicyEventType =
  | "arch_goal_redirected"
  | "goal_rejected"
  | "arch_agent_blocked"

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
        base_arc_ws_instance_id TEXT,
        active_arc_ws_instance_id TEXT,
        golden_arc_ws_instance_id TEXT,
        base_impl_ws_instance_id TEXT,
        active_impl_ws_instance_id TEXT
      );
      CREATE TABLE IF NOT EXISTS arc_ws_instances (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        materialized_root TEXT NOT NULL,
        mutability TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        index_json TEXT NOT NULL,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_arc_ws_instances_workspace ON arc_ws_instances(workspace_id);
      CREATE TABLE IF NOT EXISTS impl_ws_instances (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        arc_ws_instance_id TEXT,
        materialized_root TEXT NOT NULL,
        mutability TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        index_json TEXT NOT NULL,
        validation_json TEXT,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
        FOREIGN KEY (arc_ws_instance_id) REFERENCES arc_ws_instances(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_impl_ws_instances_workspace ON impl_ws_instances(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_impl_ws_instances_arc ON impl_ws_instances(arc_ws_instance_id);
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
        status TEXT NOT NULL,
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
        id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
        pid INTEGER NOT NULL,
        port INTEGER NOT NULL,
        url TEXT NOT NULL,
        cwd TEXT NOT NULL,
        started_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS storybook_states (
        id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        logs_json TEXT NOT NULL,
        error TEXT
      );
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
    const arcWsInstances = this.db.prepare(
      `SELECT * FROM arc_ws_instances WHERE workspace_id = ? ORDER BY created_at, id`
    ).all(id) as Record<string, unknown>[]
    const implWsInstances = this.db.prepare(
      `SELECT * FROM impl_ws_instances WHERE workspace_id = ? ORDER BY created_at, id`
    ).all(id) as Record<string, unknown>[]
    return {
      id: row["id"] as string,
      name: row["name"] as string,
      kind: row["kind"] === "arch" ? "arch" : "code",
      parentId: nullableString(row["parent_id"]),
      createdAt: row["created_at"] as number,
      baseArcWsInstanceId: nullableString(row["base_arc_ws_instance_id"]),
      activeArcWsInstanceId: nullableString(row["active_arc_ws_instance_id"]),
      goldenArcWsInstanceId: nullableString(row["golden_arc_ws_instance_id"]),
      baseImplWsInstanceId: nullableString(row["base_impl_ws_instance_id"]),
      activeImplWsInstanceId: nullableString(row["active_impl_ws_instance_id"]),
      goals: goals.map(mapGoal),
      arcWsInstances: Object.fromEntries(arcWsInstances.map((inst) => {
        const mapped = mapArcWsInstance(inst)
        return [mapped.id, mapped]
      })),
      implWsInstances: Object.fromEntries(implWsInstances.map((inst) => {
        const mapped = mapImplWsInstance(inst)
        return [mapped.id, mapped]
      })),
    }
  }

  saveWorkspace(ws: StoredWorkspaceRecord): void {
    this.transaction(() => {
      this.db.prepare(`
        INSERT INTO workspaces (
          id, name, kind, parent_id, created_at,
          base_arc_ws_instance_id, active_arc_ws_instance_id, golden_arc_ws_instance_id,
          base_impl_ws_instance_id, active_impl_ws_instance_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          kind = excluded.kind,
          parent_id = excluded.parent_id,
          created_at = excluded.created_at,
          base_arc_ws_instance_id = excluded.base_arc_ws_instance_id,
          active_arc_ws_instance_id = excluded.active_arc_ws_instance_id,
          golden_arc_ws_instance_id = excluded.golden_arc_ws_instance_id,
          base_impl_ws_instance_id = excluded.base_impl_ws_instance_id,
          active_impl_ws_instance_id = excluded.active_impl_ws_instance_id
      `).run(
        ws.id,
        ws.name,
        ws.kind,
        ws.parentId,
        ws.createdAt,
        ws.baseArcWsInstanceId,
        ws.activeArcWsInstanceId,
        ws.goldenArcWsInstanceId,
        ws.baseImplWsInstanceId,
        ws.activeImplWsInstanceId,
      )

      this.db.prepare(`DELETE FROM impl_ws_instances WHERE workspace_id = ?`).run(ws.id)
      this.db.prepare(`DELETE FROM arc_ws_instances WHERE workspace_id = ?`).run(ws.id)
      for (const inst of Object.values(ws.arcWsInstances)) {
        this.db.prepare(`
          INSERT INTO arc_ws_instances (id, workspace_id, materialized_root, mutability, created_at, index_json)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(inst.id, ws.id, inst.materializedRoot, inst.mutability, inst.createdAt, JSON.stringify(inst.index))
      }
      for (const inst of Object.values(ws.implWsInstances)) {
        this.db.prepare(`
          INSERT INTO impl_ws_instances (
            id, workspace_id, arc_ws_instance_id, materialized_root, mutability, created_at, index_json, validation_json
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          inst.id,
          ws.id,
          inst.arcWsInstanceId,
          inst.materializedRoot,
          inst.mutability,
          inst.createdAt,
          JSON.stringify(inst.index),
          inst.validation == null ? null : JSON.stringify(inst.validation),
        )
      }

      this.db.prepare(`DELETE FROM goals WHERE workspace_id = ?`).run(ws.id)
      ws.goals.forEach((goal, position) => {
        this.db.prepare(`
          INSERT INTO goals (
            id, workspace_id, position_index, text, label, target, mode, created_at,
            story_id, selector, component, status, session_id
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          goal.status,
          goal.sessionId ?? null,
        )
      })
    })
  }

  deleteWorkspace(id: string): void {
    this.transaction(() => {
      this.db.prepare(`DELETE FROM goals WHERE workspace_id = ?`).run(id)
      this.db.prepare(`DELETE FROM impl_ws_instances WHERE workspace_id = ?`).run(id)
      this.db.prepare(`DELETE FROM arc_ws_instances WHERE workspace_id = ?`).run(id)
      this.db.prepare(`DELETE FROM storybooks WHERE id = ?`).run(id)
      this.db.prepare(`DELETE FROM storybook_states WHERE id = ?`).run(id)
      this.db.prepare(`DELETE FROM workspace_policy_events WHERE workspace_id = ?`).run(id)
      this.db.prepare(`DELETE FROM workspaces WHERE id = ?`).run(id)
    })
  }

  deleteAllWorkspaces(): void {
    this.transaction(() => {
      this.db.prepare(`DELETE FROM goals`).run()
      this.db.prepare(`DELETE FROM impl_ws_instances`).run()
      this.db.prepare(`DELETE FROM arc_ws_instances`).run()
      this.db.prepare(`DELETE FROM storybooks`).run()
      this.db.prepare(`DELETE FROM storybook_states`).run()
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

function mapGoal(row: Record<string, unknown>): StoredGoal {
  return {
    id: row["id"] as string,
    workspaceId: row["workspace_id"] as string,
    text: row["text"] as string,
    label: row["label"] as string,
    target: row["target"] as string,
    mode: row["mode"] === "arch" ? "arch" : "code",
    createdAt: row["created_at"] as number,
    storyId: nullableString(row["story_id"]),
    selector: nullableString(row["selector"]),
    component: nullableString(row["component"]),
    status: row["status"] as StoredGoal["status"],
    sessionId: nullableString(row["session_id"]),
  }
}

function mapArcWsInstance(row: Record<string, unknown>): StoredArcWsInstance {
  return {
    id: row["id"] as string,
    workspaceId: row["workspace_id"] as string,
    materializedRoot: row["materialized_root"] as string,
    mutability: row["mutability"] === "immutable" ? "immutable" : "writable",
    createdAt: row["created_at"] as number,
    index: JSON.parse(row["index_json"] as string),
  }
}

function mapImplWsInstance(row: Record<string, unknown>): StoredImplWsInstance {
  const validationJson = row["validation_json"]
  return {
    id: row["id"] as string,
    workspaceId: row["workspace_id"] as string,
    arcWsInstanceId: nullableString(row["arc_ws_instance_id"]),
    materializedRoot: row["materialized_root"] as string,
    mutability: row["mutability"] === "immutable" ? "immutable" : "writable",
    createdAt: row["created_at"] as number,
    index: JSON.parse(row["index_json"] as string),
    validation: typeof validationJson === "string" ? JSON.parse(validationJson) : null,
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
