import type { FC } from "react"
import type { VinylRecord } from "../types"

interface RecordCardProps {
  record: VinylRecord
  selected?: boolean
  onSelect?: (id: string) => void
}

export const RecordCard: FC<RecordCardProps> = ({ record, selected = false, onSelect }) => {
  const stars = "★★★★★".slice(0, record.rating)

  return (
    <article className={`record-card ${selected ? "selected" : ""}`}>
      <button
        className={`cover cover-${record.colorway}`}
        type="button"
        aria-label={`Select ${record.title}`}
        aria-pressed={selected}
        onClick={() => onSelect?.(record.id)}
      >
        <span className="disc" />
        <span className="cover-label">{record.format}</span>
      </button>
      <div className="record-copy">
        <div className="record-meta">
          <span>{record.year}</span>
          <span>{record.condition}</span>
        </div>
        <h3>{record.title}</h3>
        <p className="artist">{record.artist}</p>
        <p className="notes">{record.notes}</p>
        <div className="record-footer">
          <span>{record.genre}</span>
          <span aria-label={`${record.rating} out of 5 stars`}>{stars}</span>
        </div>
      </div>
    </article>
  )
}
