// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { spawn, type ChildProcess } from "node:child_process"
import { createServer } from "node:net"
import { chromium, type Browser, type Page } from "playwright"

const ANSI_RE = /\x1B\[[0-?]*[ -/]*[@-~]/g

let server: ChildProcess
let browser: Browser
let baseUrl: string

async function findPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once("error", reject)
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address()
      probe.close(() => {
        if (typeof address === "object" && address) resolve(address.port)
        else reject(new Error("No available port"))
      })
    })
  })
}

async function waitForVite(proc: ChildProcess, timeoutMs = 90_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = ""
    const timeout = setTimeout(() => reject(new Error(`Vite did not start\n${output}`)), timeoutMs)
    const onData = (data: Buffer) => {
      output += data.toString()
      const clean = output.replace(ANSI_RE, "")
      const match = clean.match(/Local:\s+(http:\/\/(?:127\.0\.0\.1|localhost):\d+)/)
      if (match?.[1]) {
        clearTimeout(timeout)
        resolve(match[1])
      }
    }
    proc.stdout?.on("data", onData)
    proc.stderr?.on("data", onData)
    proc.once("close", (code) => {
      clearTimeout(timeout)
      reject(new Error(`Vite exited with code ${code}\n${output}`))
    })
  })
}

async function assetNames(page: Page): Promise<string[]> {
  return page.getByLabel("Maintenance tasks").locator("strong").allTextContents()
}

describe("household maintenance e2e", () => {
  beforeAll(async () => {
    const port = await findPort()
    server = spawn("pnpm", ["dev", "--", "--port", String(port)], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      env: { ...process.env },
    })
    baseUrl = await waitForVite(server)
    browser = await chromium.launch({ headless: true })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    if (server?.pid) {
      try { process.kill(-server.pid, "SIGTERM") } catch {}
    }
    server?.kill()
  }, 30_000)

  it("supports triage, zone filtering, search, sort, and selection", async () => {
    const page = await browser.newPage({ viewport: { width: 1360, height: 900 } })

    try {
      await page.goto(baseUrl, { waitUntil: "networkidle" })

      await expect.poll(() => assetNames(page)).toEqual([
        "Smoke detectors",
        "Sump pump",
        "Air handler",
        "Water heater",
        "Range hood",
        "Deck boards",
        "Irrigation manifold",
      ])

      await page.getByLabel("Status").selectOption("Overdue")
      await expect.poll(() => assetNames(page)).toEqual(["Smoke detectors", "Sump pump"])

      await page.getByLabel("Status").selectOption("All")
      await page.getByLabel("Zone").selectOption("Basement")
      await expect.poll(() => assetNames(page)).toEqual(["Sump pump", "Air handler"])

      await page.getByLabel("Search").fill("backup battery")
      await expect.poll(() => assetNames(page)).toEqual(["Sump pump"])

      await page.getByLabel("Search").fill("")
      await page.getByRole("button", { name: "Asset" }).click()
      await expect.poll(() => assetNames(page)).toEqual(["Air handler", "Sump pump"])

      await page.getByRole("button", { name: "Select Sump pump" }).click()
      await expect(page.getByRole("button", { name: "Select Sump pump" }).getAttribute("aria-pressed")).resolves.toBe("true")
      await expect(page.getByLabel("Selected maintenance task").innerText()).resolves.toContain("Test float switch")
    } finally {
      await page.close()
    }
  }, 60_000)

  it("keeps empty searches recoverable", async () => {
    const page = await browser.newPage({ viewport: { width: 1024, height: 768 } })

    try {
      await page.goto(baseUrl, { waitUntil: "networkidle" })
      await page.getByLabel("Search").fill("pool heater")
      await expect(page.getByRole("status").innerText()).resolves.toContain("No maintenance tasks match")

      await page.getByLabel("Search").fill("plumbing")
      await expect.poll(() => assetNames(page)).toEqual(["Water heater"])
      await expect(page.getByRole("status").count()).resolves.toBe(0)
    } finally {
      await page.close()
    }
  }, 60_000)

  it("does not overflow on mobile and keeps controls targetable", async () => {
    const page = await browser.newPage({ viewport: { width: 320, height: 844 } })

    try {
      await page.goto(baseUrl, { waitUntil: "networkidle" })
      await page.getByLabel("Zone").selectOption("Exterior")
      await expect.poll(() => assetNames(page)).toEqual(["Deck boards", "Irrigation manifold"])

      const metrics = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        searchHeight: document.querySelector<HTMLInputElement>('input[type="search"]')?.getBoundingClientRect().height ?? 0,
      }))

      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1)
      expect(metrics.searchHeight).toBeGreaterThanOrEqual(40)
    } finally {
      await page.close()
    }
  }, 60_000)

  it("supports keyboard selection and selection recovery", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 } })

    try {
      await page.goto(baseUrl, { waitUntil: "networkidle" })
      await page.getByRole("button", { name: "Select Water heater" }).focus()
      await page.keyboard.press("Enter")
      await expect(page.getByRole("button", { name: "Select Water heater" }).getAttribute("aria-pressed")).resolves.toBe("true")
      await expect(page.getByLabel("Selected maintenance task").innerText()).resolves.toContain("Flush sediment")

      await page.getByLabel("Zone").selectOption("Bedrooms")
      await expect.poll(() => assetNames(page)).toEqual(["Smoke detectors"])
      await expect(page.getByLabel("Selected maintenance task").innerText()).resolves.toContain("Smoke detectors")

      await page.getByLabel("Zone").selectOption("All")
      await expect(page.getByRole("button", { name: "Select Water heater" }).getAttribute("aria-pressed")).resolves.toBe("true")
      await expect(page.getByLabel("Selected maintenance task").innerText()).resolves.toContain("Water heater")
    } finally {
      await page.close()
    }
  }, 60_000)
})
