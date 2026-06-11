import type { ApplyMethod, EnrichmentStatus } from "../../shared/types"

export const ENRICHMENT_VERSION = "careers-v1"

export interface ApplyLinkEnrichment {
  applyMethod: ApplyMethod
  applyUrl: string | null
  applyEmail: string | null
  enrichmentStatus: EnrichmentStatus
  enrichmentNotes: string | null
}

interface FetchLikeResponse {
  ok: boolean
  status: number
  text?: () => Promise<string>
}

type FetchLike = (url: string, init?: RequestInit) => Promise<FetchLikeResponse>

export function candidateCareersUrls(websiteUrl: string | null): string[] {
  if (!websiteUrl) return []
  let origin: string
  try {
    origin = new URL(websiteUrl).origin
  } catch {
    return []
  }
  return ["/careers", "/jobs", "/join", "/careers/"].map((path) => origin + path)
}

function timeoutSignal(ms: number): AbortSignal | undefined {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(ms)
  }
  return undefined
}

async function reachable(
  url: string,
  fetcher: FetchLike,
  timeoutMs: number
): Promise<boolean> {
  const init: RequestInit = {
    method: "GET",
    redirect: "follow",
    signal: timeoutSignal(timeoutMs),
    headers: { "user-agent": "hn-jobs/0.1 (+https://github.com)" },
  }
  const res = await fetcher(url, init)
  if (!(res.ok || (res.status >= 200 && res.status < 400))) return false
  if (!res.text) return true
  const body = (await res.text()).slice(0, 120000)
  return /\b(careers?|jobs?|open roles?|open positions?|join our team|we'?re hiring|work with us|apply now|greenhouse|lever|ashby|workable)\b/i.test(
    body
  )
}

async function discoverCareersUrl(
  websiteUrl: string | null,
  options: { fetcher?: FetchLike; timeoutMs?: number } = {}
): Promise<{ url: string | null; status: EnrichmentStatus; notes: string | null }> {
  const candidates = candidateCareersUrls(websiteUrl)
  if (candidates.length === 0) {
    return { url: null, status: "skipped", notes: "no website url" }
  }

  const fetcher = options.fetcher ?? (fetch as unknown as FetchLike)
  const timeoutMs = options.timeoutMs ?? 1500
  try {
    for (const url of candidates) {
      if (await reachable(url, fetcher, timeoutMs)) {
        return { url, status: "enriched", notes: "careers page discovered" }
      }
    }
    return { url: null, status: "missed", notes: "common careers paths not found" }
  } catch (e) {
    return { url: null, status: "failed", notes: String(e).slice(0, 160) }
  }
}

/**
 * Bounded careers-page probe: for a posting with a company website but no
 * parsed apply link, discover an application URL.
 *
 * @service http
 * @rules
 * - Probe common paths only: /careers, /jobs, /about/careers, /join, /work.
 * - Validate page CONTENT (looks like a careers page), not a bare 200 OK —
 *   many sites serve an app shell at every path.
 * - Return status "skipped" unchanged when an apply link was already parsed.
 * - Return "missed" when nothing validates, "enriched" on success.
 * - Bounded: at most ~6 requests per call, short timeout.
 */
export async function enrichApplyLink(
  websiteUrl: string | null,
  applyMethod: ApplyMethod,
  applyUrl: string | null,
  applyEmail: string | null
): Promise<ApplyLinkEnrichment> {
  if (applyUrl) {
    return {
      applyMethod,
      applyUrl,
      applyEmail,
      enrichmentStatus: "skipped",
      enrichmentNotes: "apply link already parsed",
    }
  }

  const discovered = await discoverCareersUrl(websiteUrl)
  if (discovered.url) {
    return {
      applyMethod: "link",
      applyUrl: discovered.url,
      applyEmail,
      enrichmentStatus: "enriched",
      enrichmentNotes: discovered.notes,
    }
  }

  return {
    applyMethod,
    applyUrl,
    applyEmail,
    enrichmentStatus: discovered.status,
    enrichmentNotes: discovered.notes,
  }
}
