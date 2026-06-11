import type { FC } from "react"
import type { Thread } from "../../shared/types"
import { formatMonth, formatDate } from "../format"

interface ThreadsViewProps {
  threads: Thread[]
}

export const ThreadsView: FC<ThreadsViewProps> = ({ threads }) => {
  return (
    <div>
      <p className="results-info">
        {threads.length} monthly thread{threads.length === 1 ? "" : "s"} indexed.
      </p>
      {threads.length === 0 && (
        <p className="muted">
          No threads yet. Run an ingest to pull the latest &ldquo;Who is hiring?&rdquo; thread
          from Hacker News.
        </p>
      )}
      <div>
        {threads.map((t) => (
          <div className="feed-item" key={t.id}>
            <div className="feed-title">
              <a href={`/?month=${t.month}`}>{formatMonth(t.month)}</a>
              <span className="muted"> · {t.jobCount} postings</span>
            </div>
            <div className="feed-meta">
              {t.title} · posted {formatDate(t.postedAt)} ·{" "}
              <a
                href={`https://news.ycombinator.com/item?id=${t.hnId}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                HN thread ↗
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
