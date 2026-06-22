#!/usr/bin/env node
// Benchmark: measures real browser time from studio load → story iframe rendered.
//
// Usage:
//   node bench-storybook-startup.mjs [studio-url]
//
// Default studio URL: http://localhost:5173 (or pass your own).
// The studio must already be running (`pnpm run dev` in studio/).

import { chromium } from "playwright"

const STUDIO_URL = process.argv[2] || "http://localhost:5182"
const TIMEOUT = 120_000

async function run() {
  const browser = await chromium.launch({ headless: false })
  const page = await browser.newPage()

  const t0 = Date.now()
  const lap = (msg) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`)

  // 1. Load studio
  lap("Opening studio: " + STUDIO_URL)
  await page.goto(STUDIO_URL, { waitUntil: "domcontentloaded" })
  lap("Studio DOM loaded")

  // 2. Wait for sidebar to populate (index ready)
  await page.waitForSelector(".sidebar-tree .anode", { timeout: TIMEOUT })
  lap("Sidebar tree populated (index ready)")

  // 3. Click a component node that has stories, then click the Story tab
  const compNode = page.locator(".sidebar-tree .anode.component").first()
  await compNode.waitFor({ timeout: TIMEOUT })
  await compNode.click()
  lap("Clicked component node")

  const storyTab = page.locator("button.tab", { hasText: "Story" })
  await storyTab.waitFor({ timeout: TIMEOUT })
  lap("Story tab visible")
  await storyTab.click()
  lap("Clicked Story tab")

  // 4. Now we're in the story view. Measure phases:
  //    a) "Starting Storybook" spinner visible?
  const spinnerSel = ".sb-startup-header"
  const spinnerVisible = await page.locator(spinnerSel).isVisible().catch(() => false)
  if (spinnerVisible) {
    const spinnerText = await page.locator(spinnerSel).textContent()
    lap("Storybook starting: " + spinnerText.trim())
  }

  //    b) Wait for either iframe.story-frame OR sb-failed
  lap("Waiting for iframe or failure...")
  const result = await Promise.race([
    page.waitForSelector("iframe.story-frame", { timeout: TIMEOUT }).then(() => "iframe"),
    page.waitForSelector(".sb-failed", { timeout: TIMEOUT }).then(() => "failed"),
  ])

  if (result === "failed") {
    const error = await page.locator(".sb-startup-error").textContent().catch(() => "unknown")
    lap("FAILED: Storybook failed to start — " + error)
    await browser.close()
    process.exit(1)
  }

  lap("iframe.story-frame appeared in DOM")

  // 5. Wait for the iframe to actually load content
  const iframe = page.frameLocator("iframe.story-frame")
  try {
    await iframe.locator("body").waitFor({ timeout: 30_000 })
    lap("iframe body loaded")

    // Wait for something meaningful to render inside the iframe
    // (any non-empty content in #storybook-root or body)
    await iframe.locator("#storybook-root :first-child, body :first-child").first().waitFor({ timeout: 30_000 })
    lap("iframe content rendered — DONE")
  } catch (e) {
    lap("iframe content did not render within 30s: " + e.message)
  }

  const total = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`\n=== Total: ${total}s from page load to story rendered ===\n`)

  await page.waitForTimeout(2000) // brief pause so you can see it
  await browser.close()
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
