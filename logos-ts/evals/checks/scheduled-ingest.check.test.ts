// Oracle for the scheduled ingest architecture eval. Copied into the HN Jobs
// project root at check time; the agent never sees this file.
import assert from "node:assert/strict";
import test from "node:test";

import {
  runScheduledIngest,
  startIngestSchedule,
  type ScheduledIngestDeps,
} from "./lib/hn/scheduler";
import type { HiringThread } from "./lib/hn/fetch";
import type { IngestResult } from "./lib/hn/ingest";

const juneThread: HiringThread = {
  hnId: "thread-june",
  title: "Ask HN: Who is hiring? (June 2026)",
  postedAt: new Date("2026-06-01T00:00:00Z"),
};

function ingestResult(thread: HiringThread): IngestResult {
  return {
    hnId: thread.hnId,
    month: "2026-06",
    title: thread.title,
    inserted: 1,
    updated: 0,
    total: 1,
  };
}

function fakeDeps(
  newest: Awaited<ReturnType<ScheduledIngestDeps["findNewestStoredThread"]>> = null,
) {
  let findCalls = 0;
  const ingested: HiringThread[] = [];
  const deps: ScheduledIngestDeps = {
    async findHiringThreads() {
      findCalls += 1;
      return [juneThread];
    },
    async findNewestStoredThread() {
      return newest;
    },
    async ingestThread(thread) {
      ingested.push(thread);
      return ingestResult(thread);
    },
  };
  return { deps, calls: () => findCalls, ingested };
}

test("runScheduledIngest can discover and ingest the expected new month using injected deps", async () => {
  const fake = fakeDeps(null);

  const result = await runScheduledIngest(new Date("2026-06-02T12:00:00Z"), fake.deps);

  assert.equal(result.action, "ingest-new-thread");
  assert.equal(fake.calls(), 1);
  assert.deepEqual(fake.ingested.map((thread) => thread.hnId), ["thread-june"]);
});

test("runScheduledIngest skips a recently ingested current-month thread without fetching HN", async () => {
  const fake = fakeDeps({
    hnId: "thread-june",
    month: "2026-06",
    postedAt: new Date("2026-06-01T00:00:00Z"),
    lastIngestedAt: new Date("2026-06-02T11:55:00Z"),
  });

  const result = await runScheduledIngest(new Date("2026-06-02T12:00:00Z"), fake.deps);

  assert.equal(result.action, "skip");
  assert.match(result.reason ?? "", /ingested recently/);
  assert.equal(fake.calls(), 0);
  assert.equal(fake.ingested.length, 0);
});

test("startIngestSchedule runs immediately, repeats, and clears its interval", async () => {
  const fake = fakeDeps(null);
  let scheduled: (() => void | Promise<void>) | undefined;
  let cleared = false;
  const timers = {
    setInterval(callback: () => void | Promise<void>, intervalMs: number) {
      assert.equal(intervalMs, 60_000);
      scheduled = callback;
      return 123 as unknown as ReturnType<typeof setInterval>;
    },
    clearInterval(handle: ReturnType<typeof setInterval>) {
      assert.equal(handle, 123 as unknown as ReturnType<typeof setInterval>);
      cleared = true;
    },
  };

  const stop = startIngestSchedule(fake.deps, 60_000, timers);
  await Promise.resolve();
  assert.equal(fake.calls(), 1);

  assert.ok(scheduled);
  await scheduled();
  assert.equal(fake.calls(), 2);

  stop();
  assert.equal(cleared, true);
});
