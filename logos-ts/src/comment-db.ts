// Shared SQLite comment database used by both the studio and Storybook servers.
// Single source of truth at <projectRoot>/.logos/comments.db.

import { createRequire } from "node:module"
import { promises as fs, readFileSync, existsSync } from "node:fs"
import path from "node:path"

const nodeRequire = createRequire(import.meta.url)
const { DatabaseSync } = nodeRequire("node:sqlite") as {
  DatabaseSync: new (path: string) => SqliteDb
}

interface SqliteStmt {
  run(...params: unknown[]): unknown
  get(...params: unknown[]): Record<string, unknown> | undefined
  all(...params: unknown[]): Record<string, unknown>[]
}
interface SqliteDb {
  exec(sql: string): void
  prepare(sql: string): SqliteStmt
}

export interface CommentRow {
  id: string
  target: string
  label: string
  text: string
  workspaceId: string | null
  mode: string
  author: string
  createdAt: number
  storyId: string | null
  selector: string | null
  component: string | null
  agentId: string | null
  agentStatus: string | null
}

export interface AgentPatch {
  status?: string
  sessionId?: string
  model?: string
}

const _instances = new Map<string, SqliteDb>()

export async function open(projectRoot: string): Promise<SqliteDb> {
  const outDir = path.join(projectRoot, ".logos")
  if (_instances.has(outDir)) return _instances.get(outDir)!

  await fs.mkdir(outDir, { recursive: true })
  const dbPath = path.join(outDir, "comments.db")
  const conn = new DatabaseSync(dbPath)

  conn.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")

  conn.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id          TEXT PRIMARY KEY,
      status      TEXT NOT NULL DEFAULT 'pending',
      session_id  TEXT,
      model       TEXT,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );
  `)

  const tableInfo = conn.prepare("PRAGMA table_info(comments)").all()
  const colNames = new Set(tableInfo.map((c: Record<string, unknown>) => c.name as string))

  if (colNames.size === 0) {
    conn.exec(`
      CREATE TABLE comments (
        id            TEXT PRIMARY KEY,
        target        TEXT NOT NULL DEFAULT '',
        label         TEXT DEFAULT '',
        body          TEXT NOT NULL DEFAULT '',
        workspace_id  TEXT,
        mode          TEXT DEFAULT 'code',
        author        TEXT DEFAULT 'you',
        created_at    INTEGER NOT NULL,
        story_id      TEXT,
        selector      TEXT,
        component     TEXT,
        agent_id      TEXT REFERENCES agents(id)
      );
      CREATE INDEX idx_comments_story ON comments(story_id);
      CREATE INDEX idx_comments_agent ON comments(agent_id);
      CREATE INDEX idx_comments_workspace ON comments(workspace_id);
    `)
  } else {
    // Migrate old Storybook-only schema: add studio columns.
    if (!colNames.has("target")) conn.exec("ALTER TABLE comments ADD COLUMN target TEXT DEFAULT ''")
    if (!colNames.has("workspace_id")) conn.exec("ALTER TABLE comments ADD COLUMN workspace_id TEXT")
    if (!colNames.has("mode")) conn.exec("ALTER TABLE comments ADD COLUMN mode TEXT DEFAULT 'code'")
    if (!colNames.has("body")) conn.exec("ALTER TABLE comments ADD COLUMN body TEXT DEFAULT ''")
    // Backfill target from selector for legacy story comments.
    conn.exec("UPDATE comments SET target = selector WHERE (target IS NULL OR target = '') AND selector IS NOT NULL AND selector != ''")
  }

  _instances.set(outDir, conn)

  // Migrate legacy Storybook JSON if present.
  const legacyJson = path.join(outDir, "story-comments.json")
  await migrateStoryJson(conn, legacyJson)

  return conn
}

export function list(conn: SqliteDb, opts?: { workspaceId?: string | null; storyId?: string }): CommentRow[] {
  let sql = `
    SELECT c.id, c.target, c.label, c.body AS text,
           c.workspace_id AS workspaceId, c.mode, c.author,
           c.created_at AS createdAt,
           c.story_id AS storyId, c.selector, c.component,
           c.agent_id AS agentId, a.status AS agentStatus
      FROM comments c
      LEFT JOIN agents a ON a.id = c.agent_id`
  const params: unknown[] = []
  const where: string[] = []
  if (opts?.storyId !== undefined) {
    where.push("c.story_id = ?")
    params.push(opts.storyId)
  }
  if (where.length) sql += " WHERE " + where.join(" AND ")
  sql += " ORDER BY c.created_at ASC"
  return conn.prepare(sql).all(...params) as unknown as CommentRow[]
}

export interface NewComment {
  id: string
  target: string
  label: string
  text: string
  workspaceId?: string | null
  mode?: string
  author?: string
  createdAt: number
  storyId?: string | null
  selector?: string | null
  component?: string | null
}

export function insert(conn: SqliteDb, c: NewComment): CommentRow {
  const agentId = `agt_${shortId()}`
  const now = c.createdAt
  conn
    .prepare("INSERT INTO agents (id, status, created_at, updated_at) VALUES (?, 'pending', ?, ?)")
    .run(agentId, now, now)
  conn
    .prepare(
      `INSERT INTO comments (id, target, label, body, workspace_id, mode, author, created_at, story_id, selector, component, agent_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      c.id, c.target, c.label ?? "", c.text, c.workspaceId ?? null,
      c.mode ?? "code", c.author ?? "you", now,
      c.storyId ?? null, c.selector ?? null, c.component ?? null, agentId,
    )
  return {
    id: c.id, target: c.target, label: c.label ?? "", text: c.text,
    workspaceId: c.workspaceId ?? null, mode: c.mode ?? "code",
    author: c.author ?? "you", createdAt: now,
    storyId: c.storyId ?? null, selector: c.selector ?? null,
    component: c.component ?? null, agentId, agentStatus: "pending",
  }
}

export function remove(conn: SqliteDb, id: string): void {
  const row = conn.prepare("SELECT agent_id AS agentId FROM comments WHERE id = ?").get(id) as
    | { agentId: string | null }
    | undefined
  conn.prepare("DELETE FROM comments WHERE id = ?").run(id)
  if (row?.agentId) conn.prepare("DELETE FROM agents WHERE id = ?").run(row.agentId)
}

export function removeByWorkspace(conn: SqliteDb, workspaceId: string): void {
  const rows = conn.prepare("SELECT id FROM comments WHERE workspace_id = ?").all(workspaceId) as { id: string }[]
  for (const r of rows) remove(conn, r.id)
}

export function updateAgent(conn: SqliteDb, agentId: string, patch: AgentPatch): void {
  const now = Date.now()
  conn
    .prepare(
      `UPDATE agents SET
         status = COALESCE(?, status),
         session_id = COALESCE(?, session_id),
         model = COALESCE(?, model),
         updated_at = ?
       WHERE id = ?`,
    )
    .run(patch.status ?? null, patch.sessionId ?? null, patch.model ?? null, now, agentId)
}

export async function writeDigest(conn: SqliteDb, outDir: string): Promise<void> {
  const rows = list(conn)
  const lines: string[] = [
    "# Comments",
    "",
    "Human feedback pinned to code symbols and Storybook component elements.",
    "Each comment is owned by exactly one agent; agents treat open comments as requirements.",
    "",
  ]
  const byStory = new Map<string, CommentRow[]>()
  const codeComments: CommentRow[] = []
  for (const r of rows) {
    if (r.storyId) {
      const arr = byStory.get(r.storyId) ?? []
      arr.push(r)
      byStory.set(r.storyId, arr)
    } else {
      codeComments.push(r)
    }
  }
  if (codeComments.length) {
    lines.push("## Code comments", "")
    for (const r of codeComments) {
      const when = new Date(r.createdAt).toISOString().slice(0, 16).replace("T", " ")
      lines.push(
        `- **${r.label}** (${r.target}) — ${r.text.replace(/\n+/g, " ")} ` +
          `_(${r.author}, ${when})_ → agent \`${r.agentId}\` [${r.agentStatus}]` +
          (r.workspaceId ? ` workspace:${r.workspaceId}` : ""),
      )
    }
    lines.push("")
  }
  for (const [storyId, storyList] of byStory) {
    lines.push(`## ${storyId}${storyList[0]?.component ? ` — ${storyList[0].component}` : ""}`, "")
    for (const r of storyList) {
      const when = new Date(r.createdAt).toISOString().slice(0, 16).replace("T", " ")
      lines.push(
        `- **${r.label}** — ${r.text.replace(/\n+/g, " ")} ` +
          `_(${r.author}, ${when})_ → agent \`${r.agentId}\` [${r.agentStatus}]` +
          (r.workspaceId ? ` workspace:${r.workspaceId}` : ""),
      )
    }
    lines.push("")
  }
  await fs.writeFile(path.join(outDir, "story-comments.md"), lines.join("\n"))
}

async function migrateStoryJson(conn: SqliteDb, jsonPath: string): Promise<void> {
  if (!existsSync(jsonPath)) return
  const count = conn.prepare("SELECT COUNT(*) AS n FROM comments WHERE story_id IS NOT NULL").get() as { n: number }
  if (count.n > 0) return
  let legacy: Array<Record<string, unknown>>
  try {
    legacy = JSON.parse(readFileSync(jsonPath, "utf8"))
  } catch {
    return
  }
  for (const c of legacy) {
    const storyId = String(c.storyId ?? "")
    insert(conn, {
      id: String(c.id),
      target: String(c.selector ?? ""),
      label: String(c.label ?? ""),
      text: String(c.body ?? ""),
      author: String(c.author ?? "you"),
      createdAt: Number(c.createdAt) || Date.now(),
      storyId,
      selector: String(c.selector ?? ""),
      component: deriveComponent(storyId, c.component as string | undefined),
    })
  }
  await fs.rename(jsonPath, jsonPath + ".imported").catch(() => {})
}

export async function migrateStudioJson(conn: SqliteDb, jsonPath: string): Promise<void> {
  if (!existsSync(jsonPath)) return
  let legacy: Array<Record<string, unknown>>
  try {
    legacy = JSON.parse(readFileSync(jsonPath, "utf8"))
  } catch {
    return
  }
  if (!legacy.length) return
  for (const c of legacy) {
    const id = String(c.id)
    const exists = conn.prepare("SELECT 1 FROM comments WHERE id = ?").get(id)
    if (exists) continue
    insert(conn, {
      id,
      target: String(c.target ?? ""),
      label: String(c.label ?? ""),
      text: String(c.text ?? ""),
      workspaceId: (c.workspaceId as string) ?? null,
      mode: String(c.mode ?? "code"),
      createdAt: Number(c.createdAt) || Date.now(),
    })
  }
  await fs.rename(jsonPath, jsonPath + ".imported").catch(() => {})
}

function deriveComponent(storyId: string, explicit?: string): string {
  if (explicit) return explicit
  return storyId.split("--")[0]?.split("-").slice(-1)[0] ?? storyId
}

function shortId(): string {
  return Math.random().toString(36).slice(2, 10)
}
