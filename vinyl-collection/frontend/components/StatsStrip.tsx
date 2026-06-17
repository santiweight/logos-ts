import type { FC } from "react"

interface StatsStripProps {
  totalRecords: number
  visibleRecords: number
  averageRating: number
  highlightedShelf: string
}

export const StatsStrip: FC<StatsStripProps> = ({
  totalRecords,
  visibleRecords,
  averageRating,
  highlightedShelf,
}) => {
  return (
    <section className="stats-strip" aria-label="Collection stats">
      <div>
        <span>{totalRecords}</span>
        <small>records</small>
      </div>
      <div>
        <span>{visibleRecords}</span>
        <small>shown</small>
      </div>
      <div>
        <span>{averageRating.toFixed(1)}</span>
        <small>avg rating</small>
      </div>
      <div>
        <span>{highlightedShelf}</span>
        <small>active shelf</small>
      </div>
    </section>
  )
}
