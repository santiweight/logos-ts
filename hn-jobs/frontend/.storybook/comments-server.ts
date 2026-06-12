// Storybook dev-server middleware for element-pinned story comments.
// Delegates all persistence to the shared comment-db module so comments are
// visible from both the studio and Storybook UIs.

import type { Plugin } from "vite"
import type { IncomingMessage, ServerResponse } from "node:http"
import path from "node:path"

const LOGOS_SRC = process.env.LOGOS_TS_SRC!
const commentDb: typeof import("../../../logos-ts/src/comment-db") = require(path.join(LOGOS_SRC, "comment-db"))

export type { CommentRow } from "../../../logos-ts/src/comment-db"

const PROJECT_ROOT = process.env.LOGOS_PROJECT_ROOT!
const OUT_DIR = path.join(PROJECT_ROOT, ".logos")

type SqliteDb = Awaited<ReturnType<typeof commentDb.open>>
let _conn: SqliteDb | null = null

async function conn(): Promise<SqliteDb> {
  if (_conn) return _conn
  _conn = await commentDb.open(PROJECT_ROOT)
  return _conn
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ""
    req.on("data", (chunk: string) => (data += chunk))
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
            const db = await conn()
            const url = req.url ?? "/"

            // POST /agent — trace write-back for an agent's lifecycle.
            if (url.startsWith("/agent")) {
              if (req.method !== "POST") return end(res, 405, { error: "method not allowed" })
              const { agentId, status, sessionId, model } = JSON.parse(await readBody(req))
              commentDb.updateAgent(db, agentId, { status, sessionId, model })
              await commentDb.writeDigest(db, OUT_DIR)
              return end(res, 200, { ok: true })
            }

            if (req.method === "GET") {
              const rows = commentDb.list(db)
              await commentDb.writeDigest(db, OUT_DIR)
              // Return in the shape the CommentLayer client expects.
              return end(res, 200, { comments: rows })
            }
            if (req.method === "POST") {
              const c = JSON.parse(await readBody(req))
              const row = commentDb.insert(db, {
                id: String(c.id),
                target: String(c.selector ?? c.target ?? ""),
                label: String(c.label ?? ""),
                text: String(c.body ?? c.text ?? ""),
                workspaceId: c.workspaceId ?? null,
                mode: c.mode ?? "code",
                author: String(c.author ?? "you"),
                createdAt: Number(c.createdAt) || Date.now(),
                storyId: String(c.storyId ?? ""),
                selector: String(c.selector ?? ""),
                component: c.component ?? deriveComponent(c.storyId),
              })
              await commentDb.writeDigest(db, OUT_DIR)
              return end(res, 200, { ok: true, comment: row })
            }
            if (req.method === "DELETE") {
              const id = new URL(url, "http://localhost").searchParams.get("id")
              if (id) commentDb.remove(db, id)
              await commentDb.writeDigest(db, OUT_DIR)
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

function deriveComponent(storyId?: string): string {
  if (!storyId) return ""
  return storyId.split("--")[0]?.split("-").slice(-1)[0] ?? storyId
}
