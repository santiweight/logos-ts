import { createHmac, timingSafeEqual } from "node:crypto"
import type { IncomingMessage, ServerResponse } from "node:http"
import type { Duplex } from "node:stream"
import type { Connect, Plugin } from "vite"

const COOKIE_NAME = "logos_session"
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60
const MAX_LOGIN_BODY_BYTES = 8 * 1024

interface AuthConfig {
  password: string
  username: string
}

function configuredAuth(): AuthConfig | null {
  const password = process.env["LOGOS_AUTH_PASSWORD"]
  if (!password) return null
  return {
    password,
    username: process.env["LOGOS_AUTH_USERNAME"] || "logos",
  }
}

function sign(payload: string, password: string): string {
  return createHmac("sha256", password).update(payload).digest("base64url")
}

function equalSecret(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left)
  const rightBytes = Buffer.from(right)
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
}

function createSession(password: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({
    expiresAt: now + SESSION_TTL_SECONDS * 1000,
  })).toString("base64url")
  return `${payload}.${sign(payload, password)}`
}

function readCookie(req: IncomingMessage, name: string): string | null {
  const header = req.headers.cookie
  if (!header) return null
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=")
    if (key === name) return value.join("=")
  }
  return null
}

export function isAuthorizedRequest(req: IncomingMessage, password: string, now = Date.now()): boolean {
  const cookie = readCookie(req, COOKIE_NAME)
  if (!cookie) return false
  const separator = cookie.lastIndexOf(".")
  if (separator < 1) return false

  const payload = cookie.slice(0, separator)
  const signature = cookie.slice(separator + 1)
  if (!equalSecret(signature, sign(payload, password))) return false

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { expiresAt?: unknown }
    return typeof parsed.expiresAt === "number" && parsed.expiresAt > now
  } catch {
    return false
  }
}

function isSecureRequest(req: IncomingMessage): boolean {
  const forwardedProto = req.headers["x-forwarded-proto"]
  return forwardedProto === "https" || ("encrypted" in req.socket && req.socket.encrypted === true)
}

function sessionCookie(req: IncomingMessage, password: string): string {
  const secure = isSecureRequest(req) ? "; Secure" : ""
  return `${COOKIE_NAME}=${createSession(password)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure}`
}

function expiredSessionCookie(req: IncomingMessage): string {
  const secure = isSecureRequest(req) ? "; Secure" : ""
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
}

function safeRedirect(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/"
  return raw
}

function loginPage(next: string, invalid: boolean): string {
  const invalidMessage = invalid
    ? `<p class="error" role="alert">The username or password was incorrect.</p>`
    : ""
  const escapedNext = next.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Log in | Logos Studio</title>
    <style>
      :root { color-scheme: dark; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #111318; color: #e5e7eb; }
      main { width: min(92vw, 360px); padding: 28px; border: 1px solid #30343d; border-radius: 8px; background: #181b21; }
      h1 { margin: 0 0 8px; font: 600 20px/1.3 system-ui, sans-serif; }
      p { margin: 0 0 20px; color: #9ca3af; font: 14px/1.5 system-ui, sans-serif; }
      label { display: block; margin: 14px 0 6px; color: #cbd5e1; font: 600 12px/1.3 system-ui, sans-serif; }
      input { width: 100%; padding: 10px 11px; border: 1px solid #3b404b; border-radius: 5px; background: #0f1115; color: inherit; }
      input:focus { outline: 2px solid #60a5fa; outline-offset: 1px; }
      button { width: 100%; margin-top: 20px; padding: 10px; border: 0; border-radius: 5px; background: #2563eb; color: white; font-weight: 700; cursor: pointer; }
      .error { margin: 14px 0 0; color: #fca5a5; }
    </style>
  </head>
  <body>
    <main>
      <h1>Logos Studio</h1>
      <p>Sign in to access the shared development environment.</p>
      ${invalidMessage}
      <form method="post" action="/login">
        <input type="hidden" name="next" value="${escapedNext}" />
        <label for="username">Username</label>
        <input id="username" name="username" autocomplete="username" required autofocus />
        <label for="password">Password</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required />
        <button type="submit">Log in</button>
      </form>
    </main>
  </body>
</html>`
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ""
    req.setEncoding("utf8")
    req.on("data", (chunk: string) => {
      body += chunk
      if (Buffer.byteLength(body) > MAX_LOGIN_BODY_BYTES) {
        reject(new Error("login request is too large"))
        req.destroy()
      }
    })
    req.on("end", () => resolve(body))
    req.on("error", reject)
  })
}

function redirect(res: ServerResponse, location: string, cookie?: string): void {
  res.statusCode = 303
  res.setHeader("location", location)
  if (cookie) res.setHeader("set-cookie", cookie)
  res.end()
}

function unauthorized(req: IncomingMessage, res: ServerResponse): void {
  if ((req.url || "").startsWith("/api/")) {
    res.statusCode = 401
    res.setHeader("content-type", "application/json")
    res.end(JSON.stringify({ error: "authentication required" }))
    return
  }
  redirect(res, `/login?next=${encodeURIComponent(safeRedirect(req.url || "/"))}`)
}

export function authPlugin(): Plugin {
  const auth = configuredAuth()
  if (!auth) {
    if (process.env["LOGOS_REQUIRE_AUTH"] === "1") {
      throw new Error("LOGOS_AUTH_PASSWORD is required when LOGOS_REQUIRE_AUTH=1")
    }
    return { name: "logos-auth-disabled" }
  }

  return {
    name: "logos-auth",
    enforce: "pre",
    configureServer(server) {
      server.httpServer?.prependListener("upgrade", (req: IncomingMessage, socket: Duplex) => {
        if (!isAuthorizedRequest(req, auth.password)) socket.destroy()
      })

      const handleRequest = async (
        req: Connect.IncomingMessage,
        res: ServerResponse,
        next: Connect.NextFunction,
      ): Promise<void> => {
        res.setHeader("referrer-policy", "same-origin")
        res.setHeader("x-content-type-options", "nosniff")

        const url = new URL(req.url || "/", "http://logos.local")
        if (url.pathname === "/login" && req.method === "GET") {
          if (isAuthorizedRequest(req, auth.password)) {
            redirect(res, safeRedirect(url.searchParams.get("next")))
            return
          }
          res.statusCode = 200
          res.setHeader("cache-control", "no-store")
          res.setHeader("content-type", "text/html; charset=utf-8")
          res.end(loginPage(safeRedirect(url.searchParams.get("next")), url.searchParams.has("invalid")))
          return
        }

        if (url.pathname === "/login" && req.method === "POST") {
          try {
            const form = new URLSearchParams(await readBody(req))
            const validUser = equalSecret(form.get("username") || "", auth.username)
            const validPassword = equalSecret(form.get("password") || "", auth.password)
            const nextUrl = safeRedirect(form.get("next"))
            if (validUser && validPassword) {
              redirect(res, nextUrl, sessionCookie(req, auth.password))
            } else {
              redirect(res, `/login?invalid=1&next=${encodeURIComponent(nextUrl)}`)
            }
          } catch {
            res.statusCode = 400
            res.end("Invalid login request")
          }
          return
        }

        if (url.pathname === "/logout" && req.method === "POST") {
          redirect(res, "/login", expiredSessionCookie(req))
          return
        }

        if (!isAuthorizedRequest(req, auth.password)) {
          unauthorized(req, res)
          return
        }
        next()
      }

      server.middlewares.use((req, res, next) => {
        void handleRequest(req, res, next)
      })
    },
  }
}

export const authTestHelpers = {
  createSession,
  safeRedirect,
}
