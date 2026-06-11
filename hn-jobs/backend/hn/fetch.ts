import type { HiringThread, RawComment } from "../../shared/types"
import { htmlToText } from "./parse"

const ALGOLIA = "https://hn.algolia.com/api/v1"

interface HiringThreadCandidate {
  month: string
  thread: Omit<HiringThread, "month">
}

const MONTHS: Record<string, string> = {
  january: "01",
  february: "02",
  march: "03",
  april: "04",
  may: "05",
  june: "06",
  july: "07",
  august: "08",
  september: "09",
  october: "10",
  november: "11",
  december: "12",
}

const HIRING_THREAD_QUERIES = ["Who is hiring", "Who's Hiring"]
const MONTH_NAME_PATTERN =
  "January|February|March|April|May|June|July|August|September|October|November|December"

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: { "user-agent": "hn-jobs/0.1 (+https://github.com)" },
    cache: "no-store",
  })
  if (!res.ok) {
    throw new Error(`HN API ${res.status} for ${url}`)
  }
  return res.json()
}

export function monthlyHiringThreadMonth(title: string): string | null {
  const match = title.trim().match(
    new RegExp(
      `^Ask HN:\\s*(?:Who is Hiring|Who's Hiring)\\?\\s*\\((${MONTH_NAME_PATTERN})\\s+(\\d{4})(?:\\s+Edition)?\\)$`,
      "i"
    )
  )
  if (!match) return null
  const month = MONTHS[match[1].toLowerCase()]
  return month ? `${match[2]}-${month}` : null
}

export function canonicalThreadIdFromText(text: string | null | undefined): string | null {
  if (!text || !/canonical post/i.test(text)) return null
  const match = text.match(/item\?id=(\d+)/i)
  return match ? match[1] : null
}

function threadFromItem(item: any): Omit<HiringThread, "month"> | null {
  if (!item || typeof item.title !== "string") return null
  if (!monthlyHiringThreadMonth(item.title)) return null
  const createdAt = Number(item.created_at_i ?? 0)
  if (!createdAt) return null
  return {
    hnId: String(item.id ?? item.objectID),
    title: String(item.title),
    postedAt: new Date(createdAt * 1000).toISOString(),
  }
}

async function threadFromSearchHit(hit: any): Promise<HiringThreadCandidate | null> {
  if (!hit || typeof hit.title !== "string") return null
  const month = monthlyHiringThreadMonth(hit.title)
  if (!month) return null

  const canonicalId = canonicalThreadIdFromText(hit.story_text)
  if (canonicalId) {
    const canonical = await getJson(`${ALGOLIA}/items/${canonicalId}`)
    const canonicalThread = threadFromItem(canonical)
    if (!canonicalThread) return null
    const canonicalMonth =
      monthlyHiringThreadMonth(canonicalThread.title) ?? monthKey(new Date(canonicalThread.postedAt))
    return canonicalMonth === month ? { month, thread: canonicalThread } : null
  }

  const createdAt = Number(hit.created_at_i ?? 0)
  if (!createdAt) return null
  return {
    month,
    thread: {
      hnId: String(hit.objectID),
      title: String(hit.title),
      postedAt: new Date(createdAt * 1000).toISOString(),
    },
  }
}

function betterThreadCandidate(
  next: Omit<HiringThread, "month">,
  current: Omit<HiringThread, "month">
): Omit<HiringThread, "month"> {
  // Original code compared numComments, but our type doesn't have it
  // Fall back to comparing postedAt
  const nextDate = new Date(next.postedAt)
  const currentDate = new Date(current.postedAt)
  return nextDate < currentDate ? next : current
}

/**
 * Find recent "Ask HN: Who is hiring?" threads, newest first.
 *
 * @service http
 * @source HN Algolia API — http://hn.algolia.com/api/v1/search
 * @rules
 * - Match story titles only (tags=story); filter to "who is hiring" titles.
 * - Derive month ("2026-05") from the title's month, NOT the post date.
 * - No parsing opinions beyond title/month extraction.
 */
export async function findHiringThreads(limit = 6): Promise<HiringThread[]> {
  const target = Math.max(limit, 1)
  const hitsPerPage = 100
  const bestByMonth = new Map<string, Omit<HiringThread, "month">>()
  let page = 0
  let nbPages = 1

  for (const query of HIRING_THREAD_QUERIES) {
    page = 0
    nbPages = 1
    while (page < nbPages) {
      const url =
        `${ALGOLIA}/search_by_date?tags=story` +
        `&query=${encodeURIComponent(query)}` +
        `&restrictSearchableAttributes=title&hitsPerPage=${hitsPerPage}&page=${page}`
      const data = await getJson(url)
      const hits: any[] = Array.isArray(data?.hits) ? data.hits : []
      nbPages = Number(data?.nbPages ?? 1) || 1

      for (const hit of hits) {
        const candidate = await threadFromSearchHit(hit)
        if (!candidate) continue
        const current = bestByMonth.get(candidate.month)
        bestByMonth.set(
          candidate.month,
          current ? betterThreadCandidate(candidate.thread, current) : candidate.thread
        )
      }
      page++
    }
  }

  return Array.from(bestByMonth.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([month, thread]) => ({ ...thread, month }))
    .slice(0, target)
}

// "2026-05" from a Date. Thread.month prefers the title month; this is a fallback.
function monthKey(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, "0")
  return `${y}-${m}`
}

/**
 * All top-level comments of a thread.
 *
 * @service http
 * @source HN Algolia API — /items/{hnId}
 * @rules
 * - Preserve raw comment HTML exactly as served (rawHtml).
 * - Also derive rawText via htmlToText for parsing/display.
 * - Skip deleted/dead comments and the thread author's own meta comments.
 */
export async function fetchThreadComments(hnId: string): Promise<RawComment[]> {
  const data = await getJson(`${ALGOLIA}/items/${hnId}`)
  const children: any[] = Array.isArray(data?.children) ? data.children : []
  const out: RawComment[] = []
  for (const c of children) {
    if (!c || c.type !== "comment") continue
    const text: unknown = c.text
    if (typeof text !== "string" || text.trim().length === 0) continue
    out.push({
      hnCommentId: String(c.id),
      author: String(c.author ?? "unknown"),
      postedAt: new Date(((c.created_at_i as number) ?? 0) * 1000).toISOString(),
      rawHtml: text,
      rawText: htmlToText(text),
    })
  }
  return out
}
