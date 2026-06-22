import { expect, test } from "@playwright/test"

test("reviews the portfolio and selects a holding", async ({ page }) => {
  await page.goto("/")

  await expect(page.getByRole("heading", { name: "Investment Portfolio" })).toBeVisible()
  await expect(page.getByRole("region", { name: "Portfolio summary" })).toContainText("Total value")

  const detail = page.getByLabel("Selected holding")
  await expect(detail.getByRole("heading", { name: "VOO" })).toBeVisible()

  await page.getByRole("row", { name: /MSFT Microsoft Corporation Stock/ }).click()

  await expect(detail.getByRole("heading", { name: "MSFT" })).toBeVisible()
  await expect(detail).toContainText("Large-cap software exposure.")
})

test("filters, searches, sorts, and recovers from an empty result", async ({ page }) => {
  await page.goto("/")

  await page.getByRole("combobox", { name: "Asset class" }).selectOption("ETF")
  await page.getByRole("searchbox", { name: "Search" }).fill("vanguard")
  await page.getByRole("button", { name: "Symbol" }).click()

  await expect(page.getByRole("button", { name: "Symbol" })).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByRole("row", { name: /BND Vanguard Total Bond Market ETF Bond/ })).toBeHidden()
  await expect(page.getByRole("row", { name: /VOO Vanguard S&P 500 ETF ETF/ })).toBeVisible()

  await page.getByRole("searchbox", { name: "Search" }).fill("zzzz")
  await expect(page.getByText("No holdings match these filters.")).toBeVisible()
  await expect(page.getByLabel("Selected holding")).toContainText("No holding selected.")

  await page.getByRole("searchbox", { name: "Search" }).fill("")
  await page.getByRole("combobox", { name: "Asset class" }).selectOption("All")
  await expect(page.getByRole("row", { name: /BTC Bitcoin Crypto/ })).toBeVisible()
})

test("supports keyboard selection and mobile layout", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 })
  await page.goto("/")

  await expect(page.getByRole("searchbox", { name: "Search" })).toBeVisible()
  await expect(page.getByRole("combobox", { name: "Asset class" })).toBeVisible()

  const appleRow = page.getByRole("row", { name: /AAPL Apple Inc\. Stock/ })
  await appleRow.focus()
  await page.keyboard.press("Enter")

  await expect(appleRow).toHaveAttribute("aria-selected", "true")
  await expect(page.getByLabel("Selected holding").getByRole("heading", { name: "AAPL" })).toBeVisible()

  const bodyWidth = await page.evaluate(() => document.body.scrollWidth)
  const viewportWidth = page.viewportSize()?.width ?? 390
  expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 1)
})

test("preserves selected holding after filter recovery", async ({ page }) => {
  await page.goto("/")

  const microsoftRow = page.getByRole("row", { name: /MSFT Microsoft Corporation Stock/ })
  await microsoftRow.click()
  await expect(page.getByLabel("Selected holding").getByRole("heading", { name: "MSFT" })).toBeVisible()

  await page.getByRole("combobox", { name: "Asset class" }).selectOption("Cash")
  await expect(page.getByLabel("Selected holding").getByRole("heading", { name: "CASH" })).toBeVisible()
  await expect(microsoftRow).toBeHidden()

  await page.getByRole("combobox", { name: "Asset class" }).selectOption("All")
  await expect(microsoftRow).toHaveAttribute("aria-selected", "true")
  await expect(page.getByLabel("Selected holding").getByRole("heading", { name: "MSFT" })).toBeVisible()
})
