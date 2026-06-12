import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { ClaudeSessionManager } from "./claude-session-manager.js"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

let mgr: ClaudeSessionManager
let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "csm-test-"))
  mgr = new ClaudeSessionManager(join(tmpDir, "sessions.db"))
})

afterEach(() => {
  mgr.close()
  rmSync(tmpDir, { recursive: true, force: true })
})

describe("ClaudeSessionManager", () => {
  describe("create + get", () => {
    it("creates a session and retrieves it by ID", () => {
      const session = mgr.create("goal-1", "ws-1")
      expect(session.goalId).toBe("goal-1")
      expect(session.workspaceId).toBe("ws-1")
      expect(session.id).toMatch(/^pending-/)

      const fetched = mgr.get(session.id)
      expect(fetched).not.toBeNull()
      expect(fetched!.goalId).toBe("goal-1")
    })

    it("retrieves a session by goal ID", () => {
      const session = mgr.create("goal-42", "ws-2")
      const fetched = mgr.getByGoalId("goal-42")
      expect(fetched).not.toBeNull()
      expect(fetched!.id).toBe(session.id)
    })

    it("returns null for nonexistent session", () => {
      expect(mgr.get("nope")).toBeNull()
      expect(mgr.getByGoalId("nope")).toBeNull()
    })

    it("enforces unique goal_id constraint", () => {
      mgr.create("goal-1", "ws-1")
      expect(() => mgr.create("goal-1", "ws-1")).toThrow()
    })
  })

  describe("setClaudeId", () => {
    it("replaces the pending ID with the real Claude session ID", () => {
      const session = mgr.create("goal-1", "ws-1")
      const oldId = session.id
      mgr.setClaudeId(oldId, "claude-real-123")

      expect(mgr.get(oldId)).toBeNull()
      expect(mgr.get("claude-real-123")).not.toBeNull()
      expect(mgr.get("claude-real-123")!.goalId).toBe("goal-1")
    })

    it("migrates events to the new session ID", () => {
      const session = mgr.create("goal-1", "ws-1")
      mgr.addEvent(session.id, "status", { message: "building context" })
      mgr.addEvent(session.id, "event", { data: "something" })

      mgr.setClaudeId(session.id, "claude-real-456")

      const events = mgr.getEvents("claude-real-456")
      expect(events).toHaveLength(2)
      expect(events[0]!.type).toBe("status")
      expect(events[1]!.type).toBe("event")
    })
  })

  describe("events", () => {
    it("adds events with incrementing sequence numbers", () => {
      const session = mgr.create("goal-1", "ws-1")
      const seq0 = mgr.addEvent(session.id, "status", { msg: "a" })
      const seq1 = mgr.addEvent(session.id, "event", { msg: "b" })
      const seq2 = mgr.addEvent(session.id, "done", { code: 0 })

      expect(seq0).toBe(0)
      expect(seq1).toBe(1)
      expect(seq2).toBe(2)
    })

    it("retrieves events in order", () => {
      const session = mgr.create("goal-1", "ws-1")
      mgr.addEvent(session.id, "status", { msg: "first" })
      mgr.addEvent(session.id, "event", { msg: "second" })

      const events = mgr.getEvents(session.id)
      expect(events).toHaveLength(2)
      expect(events[0]!.seq).toBe(0)
      expect(events[1]!.seq).toBe(1)
      expect(JSON.parse(events[0]!.payload)).toEqual({ msg: "first" })
    })

    it("getEventsByGoalId returns events via goal lookup", () => {
      const session = mgr.create("goal-1", "ws-1")
      mgr.addEvent(session.id, "status", { msg: "hi" })

      const events = mgr.getEventsByGoalId("goal-1")
      expect(events).toHaveLength(1)
    })

    it("getEventsByGoalId returns empty for unknown goal", () => {
      expect(mgr.getEventsByGoalId("nope")).toEqual([])
    })
  })

  describe("listByWorkspace", () => {
    it("lists all sessions for a workspace", () => {
      mgr.create("goal-1", "ws-1")
      mgr.create("goal-2", "ws-1")
      mgr.create("goal-3", "ws-2")

      const ws1Sessions = mgr.listByWorkspace("ws-1")
      expect(ws1Sessions).toHaveLength(2)

      const ws2Sessions = mgr.listByWorkspace("ws-2")
      expect(ws2Sessions).toHaveLength(1)
    })

    it("returns empty array for workspace with no sessions", () => {
      expect(mgr.listByWorkspace("ws-nope")).toEqual([])
    })
  })

  describe("deleteByWorkspace", () => {
    it("removes sessions and their events for a workspace", () => {
      const s1 = mgr.create("goal-1", "ws-1")
      mgr.addEvent(s1.id, "status", { msg: "a" })
      mgr.addEvent(s1.id, "done", { code: 0 })

      const s2 = mgr.create("goal-2", "ws-1")
      mgr.addEvent(s2.id, "event", { msg: "b" })

      mgr.create("goal-3", "ws-2")

      mgr.deleteByWorkspace("ws-1")

      expect(mgr.listByWorkspace("ws-1")).toEqual([])
      expect(mgr.getEvents(s1.id)).toEqual([])
      expect(mgr.getEvents(s2.id)).toEqual([])
      expect(mgr.listByWorkspace("ws-2")).toHaveLength(1)
    })
  })
})
