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

async function gridTitles(page: Page): Promise<string[]> {
  return page.getByLabel("Records").getByRole("heading", { level: 3 }).allTextContents()
}

describe("vinyl collection e2e", () => {
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

  it("supports browse, filter, search, sort, and select in one collector session", async () => {
    const page = await browser.newPage({ viewport: { width: 1360, height: 900 } })

    try {
      await page.goto(baseUrl, { waitUntil: "networkidle" })

      await expect.poll(() => gridTitles(page)).toEqual([
        "Pastel Blues",
        "Remain in Light",
        "In a Silent Way",
        "Untrue",
        "Promise",
        "Con Todo El Mundo",
      ])
      await expect(page.getByRole("heading", { name: "Pastel Blues" }).count()).resolves.toBeGreaterThan(0)

      await page.getByLabel("Shelf").selectOption("Essentials")
      await expect.poll(() => gridTitles(page)).toEqual(["Pastel Blues", "In a Silent Way"])
      await expect(page.getByLabel("Collection stats").innerText()).resolves.toMatch(/2\s+SHOWN/)

      await page.getByLabel("Search").fill("ring wear")
      await expect.poll(() => gridTitles(page)).toEqual(["In a Silent Way"])
      await expect(page.getByRole("heading", { name: "In a Silent Way" }).count()).resolves.toBeGreaterThan(0)

      await page.getByLabel("Search").fill("")
      await page.getByRole("button", { name: "Top rated" }).click()
      await expect.poll(() => gridTitles(page)).toEqual(["In a Silent Way", "Pastel Blues"])

      await page.getByLabel("Shelf").selectOption("All")
      await page.getByRole("button", { name: "Artist A-Z" }).click()
      await expect.poll(() => gridTitles(page)).toEqual([
        "Untrue",
        "Con Todo El Mundo",
        "In a Silent Way",
        "Pastel Blues",
        "Promise",
        "Remain in Light",
      ])

      await page.getByRole("button", { name: "Select Remain in Light" }).click()
      await expect(page.getByRole("button", { name: "Select Remain in Light" }).getAttribute("aria-pressed")).resolves.toBe("true")
      await expect(page.getByRole("heading", { name: "Remain in Light" }).count()).resolves.toBeGreaterThan(0)
    } finally {
      await page.close()
    }
  }, 60_000)

  it("keeps controls usable and avoids horizontal overflow on mobile", async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })

    try {
      await page.goto(baseUrl, { waitUntil: "networkidle" })
      await page.getByLabel("Search").fill("sade")
      await expect.poll(() => gridTitles(page)).toEqual(["Promise"])

      await page.setViewportSize({ width: 320, height: 720 })
      await page.getByRole("button", { name: "Top rated" }).click()

      const metrics = await page.evaluate(() => {
        const searchBox = document.querySelector<HTMLInputElement>('input[type="search"]')?.getBoundingClientRect()
        const sortButtons = Array.from(document.querySelectorAll<HTMLButtonElement>(".shelf-filters button"))
          .map((button) => button.getBoundingClientRect())

        return {
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          searchHeight: searchBox?.height ?? 0,
          sortButtonsFit: sortButtons.every((box) => box.left >= 0 && box.right <= document.documentElement.clientWidth + 1),
        }
      })

      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1)
      expect(metrics.searchHeight).toBeGreaterThanOrEqual(40)
      expect(metrics.sortButtonsFit).toBe(true)
    } finally {
      await page.close()
    }
  }, 60_000)

  it("keeps the empty search recoverable", async () => {
    const page = await browser.newPage({ viewport: { width: 1024, height: 768 } })

    try {
      await page.goto(baseUrl, { waitUntil: "networkidle" })
      await page.getByLabel("Search").fill("acetate test pressing")
      await expect(page.getByRole("status").innerText()).resolves.toContain("No records match this crate")

      await page.getByLabel("Search").fill("sade")
      await expect.poll(() => gridTitles(page)).toEqual(["Promise"])
      await expect(page.getByRole("status").count()).resolves.toBe(0)
    } finally {
      await page.close()
    }
  }, 60_000)

  it("supports keyboard cover selection and preserves selection after filter recovery", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 } })

    try {
      await page.goto(baseUrl, { waitUntil: "networkidle" })

      await page.getByRole("button", { name: "Select Promise" }).focus()
      await page.keyboard.press("Enter")
      await expect(page.getByRole("button", { name: "Select Promise" }).getAttribute("aria-pressed")).resolves.toBe("true")
      await expect(page.getByLabel("Now spinning").getByRole("heading", { name: "Promise" }).count()).resolves.toBe(1)

      await page.getByLabel("Shelf").selectOption("Essentials")
      await expect.poll(() => gridTitles(page)).toEqual(["Pastel Blues", "In a Silent Way"])
      await expect(page.getByLabel("Now spinning").getByRole("heading", { name: "Pastel Blues" }).count()).resolves.toBe(1)

      await page.getByLabel("Shelf").selectOption("All")
      await expect(page.getByRole("button", { name: "Select Promise" }).getAttribute("aria-pressed")).resolves.toBe("true")
      await expect(page.getByLabel("Now spinning").getByRole("heading", { name: "Promise" }).count()).resolves.toBe(1)
    } finally {
      await page.close()
    }
  }, 60_000)
})
