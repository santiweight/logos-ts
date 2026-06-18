import { request as httpRequest } from "node:http"
import { connect } from "node:net"
import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from "node:http"
import type { Duplex } from "node:stream"
import type { Connect, Plugin } from "vite"
import type { StorybookManager } from "../../src/storybook-manager"

interface ProxyTarget {
  id: string
  path: string
  url: URL
}

function proxyTarget(req: IncomingMessage, manager: StorybookManager): ProxyTarget | null {
  const url = new URL(req.url || "/", "http://logos.local")
  const match = url.pathname.match(/^\/storybooks\/([^/]+)(\/.*)?$/)
  if (!match?.[1]) return refererProxyTarget(req, url, manager)

  let id: string
  try {
    id = decodeURIComponent(match[1])
  } catch {
    return null
  }
  const target = manager.get(id)
  if (!target) return null
  return {
    id,
    path: `${match[2] || "/"}${url.search}`,
    url: new URL(target),
  }
}

function refererProxyTarget(req: IncomingMessage, url: URL, manager: StorybookManager): ProxyTarget | null {
  if (url.pathname.startsWith("/storybooks/") || url.pathname.startsWith("/runs/")) return null
  const rawReferer = req.headers.referer
  if (typeof rawReferer !== "string") return null
  const referer = new URL(rawReferer, "http://logos.local")
  const match = referer.pathname.match(/^\/storybooks\/([^/]+)(\/.*)?$/)
  if (!match?.[1]) return null

  let id: string
  try {
    id = decodeURIComponent(match[1])
  } catch {
    return null
  }
  const target = manager.get(id)
  if (!target) return null
  return {
    id,
    path: `${url.pathname}${url.search}`,
    url: new URL(target),
  }
}

function upstreamHeaders(req: IncomingMessage, target: URL): OutgoingHttpHeaders {
  const headers: OutgoingHttpHeaders = { ...req.headers }
  headers["host"] = target.host
  if (headers["origin"]) headers["origin"] = target.origin
  return headers
}

export function publicStorybookUrl(id: string): string {
  return `/storybooks/${encodeURIComponent(id)}`
}

export function storybookProxyPlugin(manager: StorybookManager): Plugin {
  return {
    name: "logos-storybook-proxy",
    configureServer(server) {
      server.httpServer?.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
        const target = proxyTarget(req, manager)
        if (!target) return

        const port = Number(target.url.port || 80)
        const upstream = connect(port, target.url.hostname)
        upstream.on("connect", () => {
          const headers = upstreamHeaders(req, target.url)
          const headerLines = Object.entries(headers).flatMap(([name, value]) => {
            if (value == null) return []
            return Array.isArray(value)
              ? value.map((item) => `${name}: ${item}`)
              : [`${name}: ${value}`]
          })
          upstream.write([
            `${req.method || "GET"} ${target.path} HTTP/${req.httpVersion}`,
            ...headerLines,
            "",
            "",
          ].join("\r\n"))
          if (head.length > 0) upstream.write(head)
          socket.pipe(upstream).pipe(socket)
        })
        upstream.on("error", () => socket.destroy())
        socket.on("error", () => upstream.destroy())
      })

      server.middlewares.use((
        req: Connect.IncomingMessage,
        res: ServerResponse,
        next: Connect.NextFunction,
      ) => {
        const target = proxyTarget(req, manager)
        if (!target) {
          if ((req.url || "").startsWith("/storybooks/")) {
            res.statusCode = 404
            res.end("Storybook is not running")
            return
          }
          next()
          return
        }

        const proxyReq = httpRequest({
          hostname: target.url.hostname,
          port: target.url.port,
          method: req.method,
          path: target.path,
          headers: upstreamHeaders(req, target.url),
        }, (proxyRes) => {
          res.statusCode = proxyRes.statusCode || 502
          for (const [name, value] of Object.entries(proxyRes.headers)) {
            if (value == null) continue
            if (name === "location") {
              const location = Array.isArray(value) ? value[0] : value
              if (!location) continue
              const rewritten = location.replace(target.url.origin, publicStorybookUrl(target.id))
              res.setHeader(name, rewritten)
            } else {
              res.setHeader(name, value)
            }
          }
          proxyRes.pipe(res)
        })
        proxyReq.on("error", (error) => {
          if (res.headersSent) {
            res.destroy(error)
            return
          }
          res.statusCode = 502
          res.end("Storybook proxy error")
        })
        req.pipe(proxyReq)
      })
    },
  }
}
