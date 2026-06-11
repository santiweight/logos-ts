// Storybook dev-server middleware persisting element-pinned story comments to a
// real SQLite database, so they reach the Logos backend agents the same way
// every other instruction does — through the repo filesystem.
//
// Model: one agent per comment (1:1). Creating a comment also creates the agent
// row that will implement it, and links them. The agent isn't spawned yet — we
// only record the relationship + lifecycle status, so a message can later be
// traced to the agent responsible for it.
//
// Artifacts under <project>/.logos/:
//   - comments.db          — SQLite source of truth (comments + agents)
//   - story-comments.md     — human/agent-readable digest regenerated on change
import type { Plugin } from "vite"
import type { IncomingMessage, ServerResponse } from "node:http"
import { createRequire } from "node:module"
import { promises as fs } from "node:fs"
import path from "node:path"

// node:sqlite is built into Node 22 but experimental, so load it untyped to
// avoid depending on @types/node shipping its declarations.
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
  storyId: string
  component: string | null
  selector: string
  label: string
  body: string
  author: string
  createdAt: number
  agentId: string
  agentStatus: string
}

// process.cwd() is hn-jobs/frontend under `npm run storybook`; the Logos project
// root (where logos.toml lives) is one level up.
const PROJECT_ROOT = path.resolve(process.cwd(), "..")
const OUT_DIR = path.join(PROJECT_ROOT, ".logos")
const DB_PATH = path.join(OUT_DIR, "comments.db")
const MD_PATH = path.join(OUT_DIR, "story-comments.md")
const LEGACY_JSON = path.join(OUT_DIR, "story-comments.json")

let _db: SqliteDb | null = null

async function db(): Promise<SqliteDb> {
  if (_db) return _db
  await fs.mkdir(OUT_DIR, { recursive: true })
  const conn = new DatabaseSync(DB_PATH)
  conn.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS agents (
      id          TEXT PRIMARY KEY,
      status      TEXT NOT NULL DEFAULT 'pending',
      session_id  TEXT,
      model       TEXT,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS comments (
      id          TEXT PRIMARY KEY,
      story_id    TEXT NOT NULL,
      component   TEXT,
      selector    TEXT NOT NULL,
      label       TEXT,
      body        TEXT NOT NULL,
      author      TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      agent_id    TEXT REFERENCES agents(id)
    );
    CREATE INDEX IF NOT EXISTS idx_comments_story ON comments(story_id);
    CREATE INDEX IF NOT EXISTS idx_comments_agent ON comments(agent_id);
  `)
  _db = conn
  await migrateLegacyJson(conn)
  return conn
}

// One-time import of the previous JSON-file persistence, if present.
async function migrateLegacyJson(conn: SqliteDb): Promise<void> {
  const count = conn.prepare("SELECT COUNT(*) AS n FROM comments").get() as { n: number }
  if (count.n > 0) return
  let legacy: Array<Record<string, unknown>>
  try {
    legacy = JSON.parse(await fs.readFile(LEGACY_JSON, "utf8"))
  } catch {
    return
  }
  for (const c of legacy) {
    insertComment(conn, {
      id: String(c.id),
      storyId: String(c.storyId),
      component: deriveComponent(c.storyId as string, c.component as string | undefined),
      selector: String(c.selector),
      label: String(c.label ?? ""),
      body: String(c.body ?? ""),
      author: String(c.author ?? "you"),
      createdAt: Number(c.createdAt) || Date.now(),
    })
  }
  await fs.rename(LEGACY_JSON, LEGACY_JSON + ".imported").catch(() => {})
}

function deriveComponent(storyId: string, explicit?: string): string {
  if (explicit) return explicit
  // Fall back to the story id's title segment, e.g. "directory-jobrow--default".
  return storyId.split("--")[0]?.split("-").slice(-1)[0] ?? storyId
}

interface NewComment {
  id: string
  storyId: string
  component: string | null
  selector: string
  label: string
  body: string
  author: string
  createdAt: number
}

// Insert a comment plus its paired agent (1:1), linked.
function insertComment(conn: SqliteDb, c: NewComment): CommentRow {
  const agentId = `agt_${shortId()}`
  const now = c.createdAt
  conn
    .prepare("INSERT INTO agents (id, status, created_at, updated_at) VALUES (?, 'pending', ?, ?)")
    .run(agentId, now, now)
  conn
    .prepare(
      `INSERT INTO comments (id, story_id, component, selector, label, body, author, created_at, agent_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(c.id, c.storyId, c.component, c.selector, c.label, c.body, c.author, now, agentId)
  return { ...c, agentId, agentStatus: "pending" }
}

function listComments(conn: SqliteDb): CommentRow[] {
  return conn
    .prepare(
      `SELECT c.id, c.story_id AS storyId, c.component, c.selector, c.label, c.body,
              c.author, c.created_at AS createdAt, c.agent_id AS agentId, a.status AS agentStatus
         FROM comments c
         LEFT JOIN agents a ON a.id = c.agent_id
        ORDER BY c.created_at ASC`,
    )
    .all() as unknown as CommentRow[]
}

function deleteComment(conn: SqliteDb, id: string): void {
  const row = conn.prepare("SELECT agent_id AS agentId FROM comments WHERE id = ?").get(id) as
    | { agentId: string | null }
    | undefined
  conn.prepare("DELETE FROM comments WHERE id = ?").run(id)
  if (row?.agentId) conn.prepare("DELETE FROM agents WHERE id = ?").run(row.agentId)
}

// Trace write-back: update an agent's lifecycle (called once agents are spawned).
function updateAgent(
  conn: SqliteDb,
  agentId: string,
  patch: { status?: string; sessionId?: string; model?: string },
): void {
  const now = Date.now()
  conn
    .prepare(
      `UPDATE agents
          SET status = COALESCE(?, status),
              session_id = COALESCE(?, session_id),
              model = COALESCE(?, model),
              updated_at = ?
        WHERE id = ?`,
    )
    .run(patch.status ?? null, patch.sessionId ?? null, patch.model ?? null, now, agentId)
}

async function writeDigest(conn: SqliteDb): Promise<void> {
  const rows = listComments(conn)
  const lines: string[] = [
    "# Story comments",
    "",
    "Human feedback pinned to specific elements of Storybook component stories.",
    "Each comment is owned by exactly one agent (the agent that will implement it);",
    "the agent id + status below is that relationship. Agents regenerating a",
    "component should treat open comments as requirements.",
    "",
  ]
  const byStory = new Map<string, CommentRow[]>()
  for (const r of rows) {
    const arr = byStory.get(r.storyId) ?? []
    arr.push(r)
    byStory.set(r.storyId, arr)
  }
  for (const [storyId, list] of byStory) {
    lines.push(`## ${storyId}${list[0]?.component ? ` — ${list[0].component}` : ""}`, "")
    for (const r of list) {
      const when = new Date(r.createdAt).toISOString().slice(0, 16).replace("T", " ")
      lines.push(
        `- **${r.label}** — ${r.body.replace(/\n+/g, " ")} ` +
          `_(${r.author}, ${when})_ → agent \`${r.agentId}\` [${r.agentStatus}]`,
      )
    }
    lines.push("")
  }
  await fs.writeFile(MD_PATH, lines.join("\n"))
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ""
    req.on("data", (chunk) => (data += chunk))
    req.on("end", () => resolve(data))
    req.on("error", reject)
  })
}

export function commentsServerPlugin(): Plugin {
  return {
    name: "story-comments-server",
    configureServer(server) {
      server.middlewares.use(
        "/api/story-comments",
        async (req: IncomingMessage, res: ServerResponse) => {
          res.setHeader("Content-Type", "application/json")
          try {
            const conn = await db()
            const url = req.url ?? "/"

            // POST /agent — trace write-back for an agent's lifecycle.
            if (url.startsWith("/agent")) {
              if (req.method !== "POST") return end(res, 405, { error: "method not allowed" })
              const { agentId, status, sessionId, model } = JSON.parse(await readBody(req))
              updateAgent(conn, agentId, { status, sessionId, model })
              await writeDigest(conn)
              return end(res, 200, { ok: true })
            }

            if (req.method === "GET") {
              await writeDigest(conn)
              return end(res, 200, { comments: listComments(conn) })
            }
            if (req.method === "POST") {
              const c = JSON.parse(await readBody(req))
              const row = insertComment(conn, {
                id: String(c.id),
                storyId: String(c.storyId),
                component: deriveComponent(c.storyId, c.component),
                selector: String(c.selector),
                label: String(c.label ?? ""),
                body: String(c.body ?? ""),
                author: String(c.author ?? "you"),
                createdAt: Number(c.createdAt) || Date.now(),
              })
              await writeDigest(conn)
              return end(res, 200, { ok: true, comment: row })
            }
            if (req.method === "DELETE") {
              const id = new URL(url, "http://localhost").searchParams.get("id")
              if (id) deleteComment(conn, id)
              await writeDigest(conn)
              return end(res, 200, { ok: true })
            }
            return end(res, 405, { error: "method not allowed" })
          } catch (err) {
            return end(res, 500, { error: String(err) })
          }
        },
      )
    },
  }
}

function end(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.end(JSON.stringify(body))
}

function shortId(): string {
  return Math.random().toString(36).slice(2, 10)
}
