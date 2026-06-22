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

function runCommentScript(target: ProxyTarget): string {
  const base = publicRunUrl(target.workspaceId, target.targetId)
  return `
(() => {
  if (window.__LOGOS_RUN_COMMENT_LAYER__) return;
  window.__LOGOS_RUN_COMMENT_LAYER__ = true;
  const base = ${JSON.stringify(base)};
  const runTargetId = ${JSON.stringify(target.targetId)};
  let goals = [];
  let pins = [];
  let popup = null;
  let hover = null;
  let altDown = false;

  const css = document.createElement("style");
  css.setAttribute("data-logos-run-comments", "");
  css.textContent = [
    ".logos-run-comment-highlight{position:fixed;z-index:2147483600;pointer-events:none;border:2px solid #2563eb;background:rgba(37,99,235,.08);box-shadow:0 0 0 9999px rgba(15,23,42,.05)}",
    ".logos-run-comment-label{position:fixed;z-index:2147483601;pointer-events:none;background:#111827;color:white;font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;padding:3px 6px;border-radius:4px}",
    ".logos-run-comment-pin{position:fixed;z-index:2147483602;width:22px;height:22px;border-radius:999px;border:0;background:#2563eb;color:white;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;box-shadow:0 4px 14px rgba(15,23,42,.25);cursor:pointer}",
    ".logos-run-comment-popup{position:fixed;z-index:2147483603;width:320px;background:white;color:#111827;border:1px solid #d1d5db;box-shadow:0 18px 45px rgba(15,23,42,.22);font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}",
    ".logos-run-comment-popup header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border-bottom:1px solid #e5e7eb;font-weight:600}",
    ".logos-run-comment-popup textarea{display:block;box-sizing:border-box;width:100%;height:92px;border:0;border-bottom:1px solid #e5e7eb;padding:8px 10px;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;resize:vertical}",
    ".logos-run-comment-popup footer{display:flex;gap:6px;justify-content:flex-end;padding:8px 10px}",
    ".logos-run-comment-popup button{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;border:1px solid #d1d5db;background:white;color:#111827;padding:4px 8px;cursor:pointer}",
    ".logos-run-comment-popup button[data-primary]{background:#2563eb;border-color:#2563eb;color:white}",
    ".logos-run-comment-toolbar{position:fixed;right:12px;bottom:12px;z-index:2147483604;background:#111827;color:white;border:1px solid rgba(255,255,255,.18);box-shadow:0 8px 28px rgba(15,23,42,.25);font:12px ui-monospace,SFMono-Regular,Menlo,monospace;padding:6px 8px;border-radius:4px;pointer-events:none}"
  ].join("\\n");
  document.head.appendChild(css);

  const uiRoot = document.createElement("div");
  uiRoot.setAttribute("data-logos-run-comment-ui", "");
  document.documentElement.appendChild(uiRoot);

  function appPath() {
    const pathname = window.location.pathname.startsWith(base)
      ? "/" + window.location.pathname.slice(base.length).replace(/^\\/+/, "")
      : window.location.pathname;
    const normalized = pathname === "" ? "/" : pathname;
    return normalized + window.location.search;
  }

  function storyId() {
    return "run:" + runTargetId + ":" + appPath();
  }

  function clientEventId() {
    return crypto.randomUUID ? crypto.randomUUID() : "logos-run-comment-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
  }

  function inUi(el) {
    return !!el?.closest?.("[data-logos-run-comment-ui]");
  }

  function cssPath(el) {
    if (el === document.body || el === document.documentElement) return "body";
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.body && node !== document.documentElement) {
      const parent = node.parentElement;
      if (!parent) break;
      let part = node.tagName.toLowerCase();
      if (node.id) {
        part += "#" + CSS.escape(node.id);
        parts.unshift(part);
        break;
      }
      const sameTag = Array.from(parent.children).filter((child) => child.tagName === node.tagName);
      if (sameTag.length > 1) part += ":nth-of-type(" + (sameTag.indexOf(node) + 1) + ")";
      parts.unshift(part);
      node = parent;
    }
    return parts.length ? "body > " + parts.join(" > ") : "body";
  }

  function resolve(selector) {
    try { return selector === "body" ? document.body : document.querySelector(selector); }
    catch { return null; }
  }

  function textOf(el, max) {
    return (el.textContent || "").trim().replace(/\\s+/g, " ").slice(0, max);
  }

  function labelFor(el) {
    const component = componentName(el);
    if (component) return component;
    const text = textOf(el, 32);
    return text ? el.tagName.toLowerCase() + " \\"" + text + "\\"" : "<" + el.tagName.toLowerCase() + ">";
  }

  function htmlContext(el) {
    const attrs = ["role", "aria-label", "title", "class", "data-logos-component"]
      .map((name) => {
        const value = el.getAttribute?.(name);
        return value ? name + "=\\"" + value.trim().slice(0, 64) + "\\"" : null;
      })
      .filter(Boolean)
      .join(" ");
    const line = "<" + el.tagName.toLowerCase() + (attrs ? " " + attrs : "") + ">" + textOf(el, 140) + "</" + el.tagName.toLowerCase() + ">";
    const parent = el.parentElement && el.parentElement !== document.body ? "\\nparent: <" + el.parentElement.tagName.toLowerCase() + ">" + textOf(el.parentElement, 100) + "</" + el.parentElement.tagName.toLowerCase() + ">" : "";
    return "selected: " + line + parent;
  }

  function componentName(el) {
    const marked = el.closest?.("[data-logos-component]");
    const explicit = marked?.getAttribute?.("data-logos-component");
    if (explicit) return explicit;
    let node = el;
    while (node && node !== document.documentElement) {
      const key = Object.keys(node).find((candidate) => candidate.startsWith("__reactFiber$") || candidate.startsWith("__reactInternalInstance$"));
      let fiber = key ? node[key] : null;
      let guard = 0;
      while (fiber && guard++ < 30) {
        const type = fiber.elementType || fiber.type;
        const name = typeof type === "function" ? (type.displayName || type.name) : typeof type === "object" && type ? (type.displayName || type.name) : "";
        if (name && /^[A-Z]/.test(name) && !/^(_app|AppRouter|Router|ErrorBoundary|Fragment|StrictMode)$/.test(name)) return name;
        fiber = fiber.return;
      }
      node = node.parentElement;
    }
    return "";
  }

  function clearHover() {
    hover?.remove();
    hover = null;
    uiRoot.querySelector("[data-logos-run-comment-hover-label]")?.remove();
  }

  function showHover(el) {
    clearHover();
    const rect = el.getBoundingClientRect();
    hover = document.createElement("div");
    hover.className = "logos-run-comment-highlight";
    hover.style.left = rect.left + "px";
    hover.style.top = rect.top + "px";
    hover.style.width = rect.width + "px";
    hover.style.height = rect.height + "px";
    const label = document.createElement("div");
    label.className = "logos-run-comment-label";
    label.setAttribute("data-logos-run-comment-hover-label", "");
    label.textContent = labelFor(el);
    label.style.left = rect.left + "px";
    label.style.top = Math.max(0, rect.top - 24) + "px";
    uiRoot.append(hover, label);
  }

  function openPopup(el, existing) {
    popup?.remove();
    const rect = el.getBoundingClientRect();
    const selectedLabel = existing?.label || labelFor(el);
    const selector = existing?.selector || cssPath(el);
    const component = componentName(el);
    popup = document.createElement("div");
    popup.className = "logos-run-comment-popup";
    popup.setAttribute("data-logos-run-comment-popup", "");
    popup.style.left = Math.min(window.innerWidth - 340, Math.max(12, rect.left)) + "px";
    popup.style.top = Math.min(window.innerHeight - 190, Math.max(12, rect.bottom + 8)) + "px";
    popup.innerHTML = "<header><span></span><button type=\\"button\\" data-close>close</button></header><textarea data-logos-run-comment-textarea placeholder=\\"Comment...\\"></textarea><footer><button type=\\"button\\" data-cancel>Cancel</button><button type=\\"button\\" data-primary data-save>Save</button></footer>";
    popup.querySelector("span").textContent = selectedLabel;
    popup.querySelector("[data-close]").addEventListener("click", () => popup?.remove());
    popup.querySelector("[data-cancel]").addEventListener("click", () => popup?.remove());
    popup.querySelector("[data-save]").addEventListener("click", () => {
      const textarea = popup.querySelector("textarea");
      const text = textarea.value.trim();
      if (!text) return;
      window.parent?.postMessage({
        type: "logos:story-comment",
        clientEventId: clientEventId(),
        storyId: storyId(),
        runTargetId,
        appPath: appPath(),
        selector,
        label: selectedLabel,
        htmlContext: htmlContext(el),
        text,
        author: "you",
        mode: "code",
        fork: false,
        autoMerge: true,
        ...(component ? { component } : {}),
      }, "*");
      popup.remove();
      popup = null;
    });
    uiRoot.appendChild(popup);
    popup.querySelector("textarea").focus();
  }

  function renderPins() {
    for (const pin of pins) pin.remove();
    pins = [];
    const currentStoryId = storyId();
    const grouped = new Map();
    for (const goal of goals) {
      if (goal.storyId !== currentStoryId || !goal.selector) continue;
      const list = grouped.get(goal.selector) || [];
      list.push(goal);
      grouped.set(goal.selector, list);
    }
    for (const [selector, list] of grouped) {
      const el = resolve(selector);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      const pin = document.createElement("button");
      pin.type = "button";
      pin.className = "logos-run-comment-pin";
      pin.setAttribute("data-logos-run-comment-pin", "");
      pin.textContent = String(list.length);
      pin.style.left = Math.max(0, rect.right - 10) + "px";
      pin.style.top = Math.max(0, rect.top - 10) + "px";
      pin.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openPopup(el, list[0]);
      });
      uiRoot.appendChild(pin);
      pins.push(pin);
    }
  }

  function postReady() {
    window.parent?.postMessage({ type: "logos:story-ready", storyId: storyId(), appPath: appPath(), runTargetId }, "*");
  }

  window.addEventListener("message", (event) => {
    if (event.data?.type !== "logos:story-goals") return;
    goals = Array.isArray(event.data.goals) ? event.data.goals : [];
    renderPins();
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Alt") altDown = true;
  });
  window.addEventListener("keyup", (event) => {
    if (event.key === "Alt") {
      altDown = false;
      clearHover();
    }
  });
  window.addEventListener("blur", () => {
    altDown = false;
    clearHover();
  });
  document.addEventListener("mousemove", (event) => {
    if (!altDown) return;
    const target = event.target;
    if (!(target instanceof Element) || inUi(target)) {
      clearHover();
      return;
    }
    showHover(target);
  }, true);
  document.addEventListener("click", (event) => {
    if (!event.altKey) return;
    const target = event.target;
    if (!(target instanceof Element) || inUi(target)) return;
    event.preventDefault();
    event.stopPropagation();
    openPopup(target);
  }, true);
  window.addEventListener("scroll", renderPins, true);
  window.addEventListener("resize", renderPins);
  const pushState = history.pushState;
  history.pushState = function() {
    const result = pushState.apply(this, arguments);
    setTimeout(() => { postReady(); renderPins(); }, 0);
    return result;
  };
  const replaceState = history.replaceState;
  history.replaceState = function() {
    const result = replaceState.apply(this, arguments);
    setTimeout(() => { postReady(); renderPins(); }, 0);
    return result;
  };
  window.addEventListener("popstate", () => setTimeout(() => { postReady(); renderPins(); }, 0));
  const toolbar = document.createElement("div");
  toolbar.className = "logos-run-comment-toolbar";
  toolbar.textContent = "Alt-click to comment";
  uiRoot.appendChild(toolbar);
  postReady();
})();
`.trim()
}

function injectRunScopeScript(html: string, target: ProxyTarget): string {
  if (html.includes("data-logos-run-scope")) return html
  const script = `<script data-logos-run-scope>${runScopeScript(target)}</script><script data-logos-run-comments>${runCommentScript(target)}</script>`
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
