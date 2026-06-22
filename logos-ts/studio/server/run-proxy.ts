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
  fromReferer: boolean
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
    fromReferer: false,
  }
}

function isOwnRunBaseRequest(req: IncomingMessage): boolean {
  const base = process.env["LOGOS_RUN_BASE"]
  if (!base) return false
  const url = new URL(req.url || "/", "http://logos.local")
  return url.pathname === base.slice(0, -1) || url.pathname.startsWith(base)
}

function refererProxyTarget(req: IncomingMessage, url: URL, manager: RunManager): ProxyTarget | null {
  if (!isRefererProxyPath(url.pathname)) return null
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
    fromReferer: true,
  }
}

function isRefererProxyPath(pathname: string): boolean {
  return !pathname.startsWith("/runs/") && !pathname.startsWith("/storybooks/")
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

function rewriteLocationHeader(location: string, target: ProxyTarget): string {
  const base = publicRunUrl(target.workspaceId, target.targetId)
  if (location.startsWith(target.url.origin)) return location.replace(target.url.origin, base)
  if (target.framework === "next" && location.startsWith("/") && !location.startsWith(base)) {
    return `${base}${location.slice(1)}`
  }
  return location
}

function isDocumentNavigation(req: IncomingMessage): boolean {
  const destination = req.headers["sec-fetch-dest"]
  if (destination === "document") return true
  const accept = req.headers.accept
  return typeof accept === "string" && accept.includes("text/html")
}

function runScopedRedirect(target: ProxyTarget, reqUrl: string): string {
  const url = new URL(reqUrl || "/", "http://logos.local")
  return `${publicRunUrl(target.workspaceId, target.targetId)}${url.pathname.replace(/^\//, "")}${url.search}`
}

function runScopeScript(target: ProxyTarget): string {
  const base = publicRunUrl(target.workspaceId, target.targetId)
  return `
(() => {
  const base = ${JSON.stringify(base)};
  const reserved = [/^\\/runs\\//, /^\\/storybooks\\//];
  function scopedUrl(value) {
    if (value == null || value === "") return value;
    try {
      const raw = String(value);
      if (/^(?:[a-z][a-z0-9+.-]*:|\\/\\/)/i.test(raw) && !raw.startsWith(window.location.origin)) {
        const external = new URL(raw, window.location.href);
        if (external.origin !== window.location.origin) return value;
      }
      const url = new URL(raw, window.location.href);
      if (url.origin !== window.location.origin) return value;
      if (url.pathname.startsWith(base) || reserved.some((re) => re.test(url.pathname))) {
        return url.pathname + url.search + url.hash;
      }
      return base + url.pathname.replace(/^\\/+/, "") + url.search + url.hash;
    } catch {
      return value;
    }
  }

  const pushState = history.pushState;
  history.pushState = function(state, title, url) {
    return pushState.call(this, state, title, arguments.length >= 3 ? scopedUrl(url) : url);
  };
  const replaceState = history.replaceState;
  history.replaceState = function(state, title, url) {
    return replaceState.call(this, state, title, arguments.length >= 3 ? scopedUrl(url) : url);
  };

  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return;
    const anchor = event.target?.closest?.("a[href]");
    if (!anchor) return;
    const target = anchor.getAttribute("target");
    if (target && target !== "_self") return;
    const href = anchor.getAttribute("href");
    if (!href || href.startsWith("#") || /^(?:mailto|tel|javascript):/i.test(href)) return;
    const scoped = scopedUrl(href);
    if (scoped !== href) {
      event.preventDefault();
      window.location.assign(scoped);
    }
  }, true);

  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const action = form.getAttribute("action");
    if (action == null || action === "") return;
    form.setAttribute("action", scopedUrl(action));
  }, true);
})();
`.trim()
}

function injectRunScopeScript(html: string, target: ProxyTarget): string {
  if (html.includes("data-logos-run-scope")) return html
  const script = `<script data-logos-run-scope>${runScopeScript(target)}</script>`
  if (html.includes("</head>")) return html.replace("</head>", `${script}</head>`)
  if (html.includes("</body>")) return html.replace("</body>", `${script}</body>`)
  return `${script}${html}`
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
        if (target.fromReferer && isDocumentNavigation(req)) {
          res.statusCode = 302
          res.setHeader("location", runScopedRedirect(target, req.url || "/"))
          res.end()
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
            res.end(injectRunScopeScript(Buffer.concat(chunks).toString("utf8"), target))
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
