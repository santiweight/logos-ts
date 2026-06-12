import { test, expect } from "vitest"
import { JobStore } from "./store"
import type { Job } from "../shared/types"

// Consumes a single method (upsertJob) -> attaches to the METHOD.
test("upsertJob preserves raw text on re-ingest", () => {
  const store = new JobStore(":memory:")
  const job = store.upsertJob({ hnCommentId: "1", rawText: "orig" } as Job)
  expect(job.rawText).toBe("orig")
})

// Consumes two methods of the same class -> attaches to the CLASS.
test("listJobs and getJob round-trip", () => {
  const store = new JobStore(":memory:")
  store.getJob(1)
  store.listJobs()
})
