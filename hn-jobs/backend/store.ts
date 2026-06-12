import type { Job, Thread } from "../shared/types"

/**
 * Persistent store for threads and postings.
 *
 * @store sqlite
 * @state threads(id PK, hnId UNIQUE, title, month UNIQUE, jobCount, lastIngestedAt)
 * @state jobs(id PK, hnCommentId UNIQUE, threadId FK, ...derived columns)
 *
 * @invariant rawHtml/rawText are written once on first insert and NEVER mutated
 *   on re-ingest — they are the durable source of truth.
 * @invariant every non-raw column is a derived cache: upsertJob and reparse may
 *   freely overwrite it.
 * @invariant hidden/hiddenReason are admin-owned. ingest/reparse must never
 *   touch them; re-ingesting a thread must not unhide a hidden post.
 * @invariant upsert is idempotent and keyed by hnCommentId (jobs) / hnId (threads).
 */
export class JobStore {
  private threads = new Map<number, Thread>()
  private jobs = new Map<number, Job>()
  private threadsByHnId = new Map<string, number>() // hnId -> thread id
  private jobsByHnCommentId = new Map<string, number>() // hnCommentId -> job id
  private nextThreadId = 1
  private nextJobId = 1

  constructor(dbPath = "hn_jobs.db") {
    // dbPath parameter kept for API compatibility, not used in-memory
  }

  /** Insert or update a thread by hnId; refresh jobCount + lastIngestedAt. */
  upsertThread(thread: Thread): Thread {
    const existingId = this.threadsByHnId.get(thread.hnId)

    if (existingId != null) {
      // Update existing thread
      const existing = this.threads.get(existingId)!
      const updated: Thread = {
        ...existing,
        ...thread,
        id: existing.id,
      }
      this.threads.set(existingId, updated)
      return updated
    } else {
      // Insert new thread
      const id = this.nextThreadId++
      const newThread: Thread = {
        ...thread,
        id,
      }
      this.threads.set(id, newThread)
      this.threadsByHnId.set(thread.hnId, id)
      return newThread
    }
  }

  /**
   * Insert or update a posting by hnCommentId. On insert, write raw + derived.
   * On update, overwrite ONLY derived columns; preserve raw + admin fields.
   */
  upsertJob(job: Job): Job {
    const existingId = this.jobsByHnCommentId.get(job.hnCommentId)

    if (existingId != null) {
      // Update existing job: preserve rawHtml, rawText, hidden, hiddenReason
      const existing = this.jobs.get(existingId)!
      const updated: Job = {
        ...job,
        id: existing.id,
        rawHtml: existing.rawHtml,
        rawText: existing.rawText,
        hidden: existing.hidden,
        hiddenReason: existing.hiddenReason,
      }
      this.jobs.set(existingId, updated)
      return updated
    } else {
      // Insert new job
      const id = this.nextJobId++
      const newJob: Job = {
        ...job,
        id,
      }
      this.jobs.set(id, newJob)
      this.jobsByHnCommentId.set(job.hnCommentId, id)
      return newJob
    }
  }

  getJob(id: number): Job | null {
    return this.jobs.get(id) ?? null
  }

  /** Visible postings for the directory. */
  listJobs(): Job[] {
    const results: Job[] = []

    for (const job of this.jobs.values()) {
      if (job.hidden) continue
      results.push(job)
    }

    return results
  }

  listThreads(): Thread[] {
    return Array.from(this.threads.values())
  }

  /** All stored raw snapshots, for reparse (no network). */
  listRawForReparse(): Pick<Job, "id" | "rawText" | "rawHtml" | "author">[] {
    const results: Pick<Job, "id" | "rawText" | "rawHtml" | "author">[] = []

    for (const job of this.jobs.values()) {
      results.push({
        id: job.id,
        rawText: job.rawText,
        rawHtml: job.rawHtml,
        author: job.author,
      })
    }

    return results
  }

  /** Admin-only moderation. Sets hidden/hiddenReason; ingest never calls this. */
  setHidden(id: number, hidden: boolean, reason: string | null): Job | null {
    const job = this.jobs.get(id)
    if (!job) return null

    const updated: Job = {
      ...job,
      hidden,
      hiddenReason: reason,
    }
    this.jobs.set(id, updated)
    return updated
  }
}
