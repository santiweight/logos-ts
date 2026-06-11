#!/usr/bin/env node
// E2E test for the comment → workspace → agent flow.
// Usage: node test-storybook-comment-flow.mjs [studioPort]
// Requires: studio dev server running.

import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const HN = resolve(__dirname, "../hn-jobs")

function getStudioPort() {
  const explicit = process.argv[2]
  if (explicit) return explicit
  try {
    return readFileSync(resolve(HN, ".logos/studio-port"), "utf8").trim()
  } catch {
    return "5180"
  }
}

const PORT = getStudioPort()
const STUDIO = `http://localhost:${PORT}`

let passed = 0
let failed = 0
let skipped = 0

function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`) }
  else { failed++; console.error(`  ✗ ${msg}`) }
}

function skip(msg) {
  skipped++
  console.log(`  ⊘ ${msg} (skipped)`)
}

async function run() {
  console.log(`\nStudio: ${STUDIO}\n`)

  // ---- 1. Connectivity ----
  console.log("--- 1. connectivity ---")
  const studioOk = await fetch(`${STUDIO}/api/index`).then(r => r.ok).catch(() => false)
  assert(studioOk, "studio /api/index reachable")
  if (!studioOk) {
    console.error("\nStudio not reachable — is it running? (`cd logos-ts/studio && npm run dev`)")
    process.exit(1)
  }

  const commentsOk = await fetch(`${STUDIO}/api/comments`).then(r => r.ok).catch(() => false)
  assert(commentsOk, "/api/comments reachable")

  const workspacesOk = await fetch(`${STUDIO}/api/workspaces`).then(r => r.ok).catch(() => false)
  assert(workspacesOk, "/api/workspaces reachable")

  // ---- 2. Sidebar comment flow ----
  console.log("\n--- 2. sidebar comment flow (workspace + comment created together) ---")

  const wsRes = await fetch(`${STUDIO}/api/workspaces`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "test-sidebar" }),
  })
  assert(wsRes.ok, `POST /api/workspaces → ${wsRes.status}`)
  const wsMeta = await wsRes.json()
  assert(!!wsMeta.id, `workspace created: ${wsMeta.id}`)

  const sidebarComment = await fetch(`${STUDIO}/api/comments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      target: "file:frontend/components/JobRow.tsx",
      label: "JobRow.tsx",
      text: "Test sidebar comment",
      mode: "code",
      workspaceId: wsMeta.id,
    }),
  }).then(r => r.json())
  assert(!!sidebarComment.id, `comment created: ${sidebarComment.id}`)
  assert(sidebarComment.workspaceId === wsMeta.id, "comment has workspaceId")

  const allAfterSidebar = await fetch(`${STUDIO}/api/comments`).then(r => r.json())
  const found = allAfterSidebar.find(c => c.id === sidebarComment.id)
  assert(!!found, "comment visible in GET /api/comments")
  assert(found?.workspaceId === wsMeta.id, "workspaceId preserved in listing")

  // ---- 3. Agent SSE stream ----
  console.log("\n--- 3. agent SSE stream ---")
  const agentUrl = `${STUDIO}/api/agent/run?workspace=${wsMeta.id}&mode=code`
  const ctrl = new AbortController()
  const collected = []
  try {
    const agentRes = await fetch(agentUrl, { signal: ctrl.signal })
    const reader = agentRes.body.getReader()
    const decoder = new TextDecoder()
    let buf = ""
    const deadline = Date.now() + 8_000
    while (Date.now() < deadline) {
      const { value, done } = await Promise.race([
        reader.read(),
        new Promise(r => setTimeout(() => r({ value: undefined, done: true }), Math.max(100, deadline - Date.now()))),
      ])
      if (done && !value) break
      if (value) buf += decoder.decode(value, { stream: true })
      const lines = buf.split("\n")
      buf = lines.pop()
      for (const l of lines) {
        if (!l.startsWith("data:")) continue
        try { collected.push(JSON.parse(l.slice(5))) } catch {}
      }
      if (collected.length >= 3) break
    }
    ctrl.abort()
    reader.cancel().catch(() => {})
    const gotStatus = collected.some(e => e.type === "status")
    assert(collected.length > 0, `SSE emitted ${collected.length} data events`)
    assert(gotStatus, "received status event(s)")
  } catch (e) {
    if (e.name === "AbortError" && collected.length > 0) {
      assert(true, `SSE emitted ${collected.length} events before abort`)
    } else if (e.name === "AbortError") {
      skip("agent SSE timed out with 0 events (claude CLI may not be available)")
    } else {
      assert(false, `agent SSE failed: ${e.message}`)
    }
  }

  // ---- 4. Orphan comment + PUT /workspace ----
  console.log("\n--- 4. orphan comment + PUT /comments/:id/workspace ---")

  const orphanRes = await fetch(`${STUDIO}/api/comments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      target: ":scope > div > table",
      label: 'table "test"',
      text: "Test orphan comment",
      mode: "code",
      component: "JobRow",
      storyId: "components-jobrow--default",
      selector: ":scope > div > table",
    }),
  }).then(r => r.json())
  assert(!!orphanRes.id, `orphan comment created: ${orphanRes.id}`)
  assert(!orphanRes.workspaceId, "orphan has no workspaceId")
  assert(orphanRes.agentStatus === "pending", "orphan agent status = pending")

  const adoptWsRes = await fetch(`${STUDIO}/api/workspaces`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "test-adopt" }),
  })
  const adoptWs = await adoptWsRes.json()
  assert(!!adoptWs.id, `adoption workspace created: ${adoptWs.id}`)

  const putRes = await fetch(`${STUDIO}/api/comments/${orphanRes.id}/workspace`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspaceId: adoptWs.id }),
  })
  assert(putRes.ok, `PUT /comments/:id/workspace → ${putRes.status}`)

  const afterAdopt = await fetch(`${STUDIO}/api/comments`).then(r => r.json())
  const adopted = afterAdopt.find(c => c.id === orphanRes.id)
  assert(adopted?.workspaceId === adoptWs.id, `orphan now has workspaceId: ${adopted?.workspaceId}`)

  // ---- 5. Context builder: component resolution ----
  console.log("\n--- 5. context builder resolves component:Name ---")
  const { execFileSync } = await import("node:child_process")
  const tsx = resolve(__dirname, "node_modules/.bin/tsx")
  try {
    const ctx = execFileSync(tsx, [resolve(__dirname, "src/context.ts"), HN, "40000", "component:JobRow"], {
      cwd: __dirname,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    })
    assert(ctx.includes("JobRow"), "context includes JobRow")
    assert(ctx.includes("FILE(S) TO EDIT"), "context includes full source section")
    assert(ctx.length > 500, `context has substance (${ctx.length} chars)`)
  } catch (e) {
    assert(false, `context builder failed: ${e.message}`)
  }

  // ---- 6. Storybook (if available) ----
  console.log("\n--- 6. storybook integration ---")
  const idx = await fetch(`${STUDIO}/api/index`).then(r => r.json())
  const sbUrl = idx.storybookUrl
  const sbOk = sbUrl ? await fetch(`${sbUrl}/api/story-comments`).then(r => r.ok).catch(() => false) : false

  if (!sbOk) {
    skip("Storybook not reachable — run `cd hn-jobs/frontend && npm run storybook` to test this section")
  } else {
    const sbCommentRes = await fetch(`${sbUrl}/api/story-comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: `test-sb-${Date.now()}`,
        storyId: "components-jobrow--default",
        selector: ":scope > div > table > tbody > tr:nth-of-type(1)",
        label: 'tr "Test storybook comment"',
        body: "Make the job title bold",
        author: "test-harness",
        createdAt: Date.now(),
        mode: "code",
      }),
    })
    const sbComment = await sbCommentRes.json()
    assert(sbCommentRes.ok, `POST to Storybook → ${sbCommentRes.status}`)
    assert(!!sbComment.comment?.id, `storybook comment created`)
    assert(!sbComment.comment?.workspaceId, "storybook comment is orphan")

    const studioComments = await fetch(`${STUDIO}/api/comments`).then(r => r.json())
    const sbInStudio = studioComments.find(c => c.id === sbComment.comment?.id)
    assert(!!sbInStudio, "storybook comment visible from studio API")
    assert(!!sbInStudio?.component, `component field set: ${sbInStudio?.component}`)

    await fetch(`${sbUrl}/api/story-comments?id=${sbComment.comment.id}`, { method: "DELETE" }).catch(() => {})
  }

  // ---- Cleanup ----
  console.log("\n--- cleanup ---")
  await fetch(`${STUDIO}/api/comments/${sidebarComment.id}`, { method: "DELETE" }).catch(() => {})
  await fetch(`${STUDIO}/api/comments/${orphanRes.id}`, { method: "DELETE" }).catch(() => {})
  await fetch(`${STUDIO}/api/workspaces/${wsMeta.id}`, { method: "DELETE" }).catch(() => {})
  await fetch(`${STUDIO}/api/workspaces/${adoptWs.id}`, { method: "DELETE" }).catch(() => {})
  console.log("  cleaned up test data")

  // ---- Summary ----
  console.log(`\n${"=".repeat(40)}`)
  console.log(`${passed} passed, ${failed} failed, ${skipped} skipped`)
  console.log(`${"=".repeat(40)}\n`)
  process.exit(failed > 0 ? 1 : 0)
}

run().catch(e => { console.error(e); process.exit(1) })
