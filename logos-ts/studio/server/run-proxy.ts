import { request as httpRequest } from "node:http"
import { connect } from "node:net"
import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from "node:http"
import type { Duplex } from "node:stream"
import type { Connect, Plugin } from "vite"
import type { RunManager } from "../../src/run-manager"

interface ProxyTarget {
  workspaceId: string
  targetId: string
  framework: "vite" | "next"
  path: string
  url: URL
}

function proxyTarget(req: IncomingMessage, manager: RunManager): ProxyTarget | null {
  const url = new URL(req.url || "/", "http://logos.local")
  const match = url.pathname.match(/^\/runs\/([^/]+)\/([^/]+)(\/.*)?$/)
  if (!match?.[1] || !match[2]) return refererProxyTarget(req, url, manager)

  let workspaceId: string
  let targetId: string
  try {
    workspaceId = decodeURIComponent(match[1])
    targetId = decodeURIComponent(match[2])
  } catch {
    return null
  }
  const entry = manager.getEntry(workspaceId, targetId)
  if (!entry) return null
  const scopedPath = `${match[3] || "/"}${url.search}`
  const routeThroughAppRoot = entry.framework === "next" || scopedPath.startsWith("/api") || scopedPath.startsWith("/ws")
  return {
    workspaceId,
    targetId,
    framework: entry.framework,
    path: routeThroughAppRoot ? scopedPath : `${url.pathname}${url.search}`,
    url: new URL(entry.url),
  }
}

function isOwnRunBaseRequest(req: IncomingMessage): boolean {
  const base = process.env.LOGOS_RUN_BASE
  if (!base) return false
  const url = new URL(req.url || "/", "http://logos.local")
  return url.pathname === base.slice(0, -1) || url.pathname.startsWith(base)
}

function refererProxyTarget(req: IncomingMessage, url: URL, manager: RunManager): ProxyTarget | null {
  if (!isFrameworkAbsolutePath(url.pathname)) return null
  const rawReferer = req.headers.referer
  if (typeof rawReferer !== "string") return null
  const referer = new URL(rawReferer, "http://logos.local")
  const match = referer.pathname.match(/^\/runs\/([^/]+)\/([^/]+)\//)
  if (!match?.[1] || !match[2]) return null

  let workspaceId: string
  let targetId: string
  try {
    workspaceId = decodeURIComponent(match[1])
    targetId = decodeURIComponent(match[2])
  } catch {
    return null
  }

  const entry = manager.getEntry(workspaceId, targetId)
  if (!entry) return null
  return {
    workspaceId,
    targetId,
    framework: entry.framework,
    path: `${url.pathname}${url.search}`,
    url: new URL(entry.url),
  }
}

function isFrameworkAbsolutePath(pathname: string): boolean {
  return pathname.startsWith("/_next/") ||
    pathname.startsWith("/__nextjs") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/manifest.webmanifest"
}

function upstreamHeaders(req: IncomingMessage, target: URL): OutgoingHttpHeaders {
  const headers: OutgoingHttpHeaders = { ...req.headers }
  headers["host"] = target.host
  if (headers["origin"]) headers["origin"] = target.origin
  headers["accept-encoding"] = "identity"
  return headers
}

export function publicRunUrl(workspaceId: string, targetId: string): string {
  return `/runs/${encodeURIComponent(workspaceId)}/${encodeURIComponent(targetId)}/`
}

function rewriteRunHtml(html: string, target: ProxyTarget): string {
  const base = publicRunUrl(target.workspaceId, target.targetId)
  const script = `<script>
(() => {
  const base = ${JSON.stringify(base)};
  const shouldRewriteNavigation = (value) => (
    typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith(base) &&
    !value.startsWith("/_next/") &&
    !value.startsWith("/__nextjs")
  );
  const rewrite = (value) => {
    if (typeof value === "string" && (value.startsWith("/api") || value.startsWith("/ws"))) return base + value.slice(1);
    if (value instanceof URL && value.origin === window.location.origin && (value.pathname.startsWith("/api") || value.pathname.startsWith("/ws"))) {
      return new URL(base + value.pathname.slice(1) + value.search + value.hash, window.location.origin);
    }
    return value;
  };
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (input instanceof Request) {
      const next = rewrite(new URL(input.url));
      if (next !== input.url && next instanceof URL) input = new Request(next, input);
    } else {
      input = rewrite(input);
    }
    return originalFetch(input, init);
  };
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    return originalOpen.call(this, method, rewrite(url), ...rest);
  };
  const OriginalWebSocket = window.WebSocket;
  window.WebSocket = function(url, protocols) {
    const next = rewrite(url);
    return protocols == null ? new OriginalWebSocket(next) : new OriginalWebSocket(next, protocols);
  };
  window.WebSocket.prototype = OriginalWebSocket.prototype;
  Object.defineProperty(window.WebSocket, "OPEN", { value: OriginalWebSocket.OPEN });
  Object.defineProperty(window.WebSocket, "CONNECTING", { value: OriginalWebSocket.CONNECTING });
  Object.defineProperty(window.WebSocket, "CLOSING", { value: OriginalWebSocket.CLOSING });
  Object.defineProperty(window.WebSocket, "CLOSED", { value: OriginalWebSocket.CLOSED });
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return;
    const target = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!target || (target.target && target.target !== "_self")) return;
    const href = target.getAttribute("href");
    if (!shouldRewriteNavigation(href)) return;
    event.preventDefault();
    window.location.href = base + href.slice(1);
  }, true);
})();
</script>`
  return html.includes("<head>")
    ? html.replace("<head>", `<head>${script}`)
    : `${script}${html}`
}

function rewriteLocationHeader(location: string, target: ProxyTarget): string {
  const base = publicRunUrl(target.workspaceId, target.targetId)
  if (location.startsWith(target.url.origin)) return location.replace(target.url.origin, base)
  if (target.framework === "next" && location.startsWith("/") && !location.startsWith(base)) {
    return `${base}${location.slice(1)}`
  }
  return location
}

export function runProxyPlugin(manager: RunManager): Plugin {
  return {
    name: "logos-run-proxy",
    configureServer(server) {
      server.httpServer?.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
        if (isOwnRunBaseRequest(req)) return
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
        if (isOwnRunBaseRequest(req)) {
          next()
          return
        }

        const target = proxyTarget(req, manager)
        if (!target) {
          if ((req.url || "").startsWith("/runs/")) {
            res.statusCode = 404
            res.end("Run is not running")
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
          const contentType = proxyRes.headers["content-type"]
          const isHtml = typeof contentType === "string" && contentType.includes("text/html")
          for (const [name, value] of Object.entries(proxyRes.headers)) {
            if (value == null) continue
            if (isHtml && name.toLowerCase() === "content-length") continue
            if (isHtml && name.toLowerCase() === "content-encoding") continue
            if (name === "location") {
              const location = Array.isArray(value) ? value[0] : value
              if (!location) continue
              res.setHeader(name, rewriteLocationHeader(location, target))
            } else {
              res.setHeader(name, value)
            }
          }
          if (!isHtml) {
            proxyRes.pipe(res)
            return
          }

          const chunks: Buffer[] = []
          proxyRes.on("data", (chunk: Buffer) => chunks.push(chunk))
          proxyRes.on("end", () => {
            res.end(rewriteRunHtml(Buffer.concat(chunks).toString("utf8"), target))
          })
        })
        proxyReq.on("error", (error) => {
          if (res.headersSent) {
            res.destroy(error)
            return
          }
          res.statusCode = 502
          res.end("Run proxy error")
        })
        req.pipe(proxyReq)
      })
    },
  }
}
