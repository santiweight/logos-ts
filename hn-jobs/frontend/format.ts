// Pure presentation formatters used by directory/detail components.
// Signatures match the shared Job fields (salaryPeriod et al. are plain strings).

export function formatCompanyName(company: string | null): string | null {
  const trimmed = company?.trim()
  return trimmed ? trimmed : null
}

export function hostLabel(url: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return null
  }
}

export function formatSalary(
  min: number | null,
  max: number | null,
  currency: string | null,
  period: string | null
): string | null {
  if (min == null && max == null) return null

  const sym = currency === "USD" ? "$" : currency ? `${currency} ` : "$"
  const k = (n: number) => (n % 1000 === 0 ? `${n / 1000}k` : n.toLocaleString())
  const range = min != null && max != null ? `${k(min)}–${k(max)}` : k((min ?? max)!)
  const suffix = period === "hour" ? "/hr" : period === "month" ? "/mo" : ""

  return `${sym}${range}${suffix}`
}

// "2026-05" → "May 2026" for display.
export function formatMonth(month: string): string {
  const [y, m] = month.split("-").map(Number)
  if (!y || !m) return month
  const date = new Date(Date.UTC(y, m - 1, 1))
  return date.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })
}

// Relative-ish date for feeds, e.g. "May 2, 2026".
export function formatDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
}

// Truncate plain text to a snippet for the directory table.
export function snippet(text: string, max = 180): string {
  const clean = text.replace(/\s+/g, " ").trim()
  if (clean.length <= max) return clean
  return clean.slice(0, max).replace(/\s+\S*$/, "") + "…"
}
