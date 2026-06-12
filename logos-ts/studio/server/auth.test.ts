// @vitest-environment node
import { describe, expect, it } from "vitest"
import { authTestHelpers, isAuthorizedRequest } from "./auth"
import type { IncomingMessage } from "node:http"

function requestWithCookie(cookie: string): IncomingMessage {
  return { headers: { cookie } } as IncomingMessage
}

describe("studio authentication", () => {
  it("accepts a signed, unexpired session", () => {
    const now = 1_800_000_000_000
    const token = authTestHelpers.createSession("secret", now)
    expect(isAuthorizedRequest(requestWithCookie(`logos_session=${token}`), "secret", now + 1_000)).toBe(true)
  })

  it("rejects tampered and expired sessions", () => {
    const now = 1_800_000_000_000
    const token = authTestHelpers.createSession("secret", now)
    expect(isAuthorizedRequest(requestWithCookie(`logos_session=${token}x`), "secret", now)).toBe(false)
    expect(isAuthorizedRequest(requestWithCookie(`logos_session=${token}`), "other", now)).toBe(false)
    expect(isAuthorizedRequest(requestWithCookie(`logos_session=${token}`), "secret", now + 8 * 24 * 60 * 60 * 1000)).toBe(false)
  })

  it("only redirects to same-origin paths", () => {
    expect(authTestHelpers.safeRedirect("/workspaces?id=1")).toBe("/workspaces?id=1")
    expect(authTestHelpers.safeRedirect("https://example.com")).toBe("/")
    expect(authTestHelpers.safeRedirect("//example.com")).toBe("/")
  })
})
