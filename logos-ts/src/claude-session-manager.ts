import { DatabaseSync } from "node:sqlite"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"

export interface ClaudeSession {
  id: string
  goalId: string
  workspaceId: string
  createdAt: number
}

export interface SessionEvent {
  id: number
  sessionId: string
  seq: number
  type: string
  payload: string
}

export class ClaudeSessionManager {
  private db: DatabaseSync

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true })
    this.db = new DatabaseSync(dbPath)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        goal_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS session_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        seq INTEGER NOT NULL,
        type TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_session ON session_events(session_id, seq);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_goal ON sessions(goal_id);
    `)
  }

  /** Register a new session for a goal. Returns a placeholder ID until Claude's real session ID arrives. */
  create(goalId: string, workspaceId: string): ClaudeSession {
    const id = `pending-${Date.now()}-${Math.round(Math.random() * 1e6)}`
    const now = Date.now()
    this.db.prepare(
      `INSERT INTO sessions (id, goal_id, workspace_id, created_at) VALUES (?, ?, ?, ?)`
    ).run(id, goalId, workspaceId, now)
    return { id, goalId, workspaceId, createdAt: now }
  }

  /** Replace the placeholder ID with the real Claude session ID from the init event. */
  setClaudeId(oldId: string, claudeSessionId: string): void {
    this.db.exec("PRAGMA foreign_keys = OFF")
    this.db.prepare(`UPDATE sessions SET id = ? WHERE id = ?`).run(claudeSessionId, oldId)
    this.db.prepare(`UPDATE session_events SET session_id = ? WHERE session_id = ?`).run(claudeSessionId, oldId)
    this.db.exec("PRAGMA foreign_keys = ON")
  }

  addEvent(sessionId: string, type: string, payload: unknown): number {
    const row = this.db.prepare(
      `SELECT COALESCE(MAX(seq), -1) as max_seq FROM session_events WHERE session_id = ?`
    ).get(sessionId) as { max_seq: number }
    const seq = row.max_seq + 1
    this.db.prepare(
      `INSERT INTO session_events (session_id, seq, type, payload) VALUES (?, ?, ?, ?)`
    ).run(sessionId, seq, type, JSON.stringify(payload))
    return seq
  }

  getByGoalId(goalId: string): ClaudeSession | null {
    const row = this.db.prepare(`SELECT * FROM sessions WHERE goal_id = ?`).get(goalId) as Record<string, unknown> | undefined
    if (!row) return null
    return mapSession(row)
  }

  get(sessionId: string): ClaudeSession | null {
    const row = this.db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(sessionId) as Record<string, unknown> | undefined
    if (!row) return null
    return mapSession(row)
  }

  getEvents(sessionId: string): SessionEvent[] {
    const rows = this.db.prepare(
      `SELECT * FROM session_events WHERE session_id = ? ORDER BY seq`
    ).all(sessionId) as Record<string, unknown>[]
    return rows.map(mapEvent)
  }

  getEventsByGoalId(goalId: string): SessionEvent[] {
    const session = this.getByGoalId(goalId)
    if (!session) return []
    return this.getEvents(session.id)
  }

  listByWorkspace(workspaceId: string): ClaudeSession[] {
    const rows = this.db.prepare(
      `SELECT * FROM sessions WHERE workspace_id = ? ORDER BY created_at DESC`
    ).all(workspaceId) as Record<string, unknown>[]
    return rows.map(mapSession)
  }

  deleteByWorkspace(workspaceId: string): void {
    const sessions = this.db.prepare(`SELECT id FROM sessions WHERE workspace_id = ?`).all(workspaceId) as { id: string }[]
    for (const s of sessions) {
      this.db.prepare(`DELETE FROM session_events WHERE session_id = ?`).run(s.id)
    }
    this.db.prepare(`DELETE FROM sessions WHERE workspace_id = ?`).run(workspaceId)
  }

  close(): void {
    this.db.close()
  }
}

function mapSession(row: Record<string, unknown>): ClaudeSession {
  return {
    id: row["id"] as string,
    goalId: row["goal_id"] as string,
    workspaceId: row["workspace_id"] as string,
    createdAt: row["created_at"] as number,
  }
}

function mapEvent(row: Record<string, unknown>): SessionEvent {
  return {
    id: row["id"] as number,
    sessionId: row["session_id"] as string,
    seq: row["seq"] as number,
    type: row["type"] as string,
    payload: row["payload"] as string,
  }
}
