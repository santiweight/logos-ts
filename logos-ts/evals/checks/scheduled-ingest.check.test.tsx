// Oracle for the "scheduled ingestion" architecture change. Copied into
// <workspace>/frontend at check time; the agent never sees this file. It
// pins the contract stated in the change request: backend/ingest.ts exports
// ingestOnce(deps) and startIngestSchedule(deps, intervalMs) → stop().
import { test, expect, vi, afterEach } from "vitest"
import type { HiringThread, RawComment } from "../shared/types"
import { JobStore } from "../backend/store"
import { ingestOnce, startIngestSchedule, type IngestDeps } from "../backend/ingest"
import { filters } from "./fixtures"

const thread: HiringThread = {
  hnId: "t1",
  title: "Ask HN: Who is hiring? (May 2026)",
  month: "2026-05",
  postedAt: "2026-05-01T00:00:00Z",
}
const comment: RawComment = {
  hnCommentId: "c1",
  author: "acmebot",
  postedAt: "2026-05-01T01:00:00Z",
  rawHtml: "",
  rawText: "Acme | Senior Engineer | Remote (US) | https://acme.example/jobs",
}

function fakeDeps(store = new JobStore(":memory:")) {
  let findCalls = 0
  const deps: IngestDeps = {
    findThreads: async () => { findCalls++; return [thread] },
    fetchComments: async (hnId: string) => (hnId === "t1" ? [comment] : []),
    store,
  }
  return { deps, store, calls: () => findCalls }
}

afterEach(() => { vi.useRealTimers() })

test("ingestOnce parses comments and upserts jobs into the store", async () => {
  const { deps, store } = fakeDeps()
  await ingestOnce(deps)
  const jobs = store.listJobs(filters({}))
  expect(jobs.length).toBe(1)
  expect(jobs[0]!.hnCommentId).toBe("c1")
  expect(jobs[0]!.rawText).toContain("Acme")
})

test("ingestOnce is idempotent — re-running does not duplicate jobs", async () => {
  const { deps, store } = fakeDeps()
  await ingestOnce(deps)
  await ingestOnce(deps)
  expect(store.listJobs(filters({})).length).toBe(1)
})

test("startIngestSchedule runs immediately, then on the interval, until stopped", async () => {
  vi.useFakeTimers()
  const { deps, calls } = fakeDeps()
  const stop = startIngestSchedule(deps, 60_000)
  await vi.advanceTimersByTimeAsync(0)
  expect(calls()).toBe(1)
  await vi.advanceTimersByTimeAsync(60_000)
  expect(calls()).toBe(2)
  await vi.advanceTimersByTimeAsync(60_000)
  expect(calls()).toBe(3)
  stop()
  await vi.advanceTimersByTimeAsync(180_000)
  expect(calls()).toBe(3)
})
