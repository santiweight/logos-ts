import { useMemo, useState, type FC } from "react"
import { averageRating, filterRecords, uniqueValues } from "../collection"
import { records as defaultRecords } from "../data/records"
import { RecordCard } from "../components/RecordCard"
import { ShelfFilters } from "../components/ShelfFilters"
import { StatsStrip } from "../components/StatsStrip"
import type { CollectionFilters, VinylRecord } from "../types"

interface CollectionViewProps {
  records?: VinylRecord[]
  initialFilters?: CollectionFilters
  featuredRecordId?: string
}

const fallbackFilters: CollectionFilters = {
  searchQuery: "",
  genre: "All",
  shelf: "All",
  sortMode: "recent",
}

export const CollectionView: FC<CollectionViewProps> = ({
  records = defaultRecords,
  initialFilters = fallbackFilters,
  featuredRecordId,
}) => {
  const [filters, setFilters] = useState(initialFilters)
  const [selectedId, setSelectedId] = useState(featuredRecordId ?? records[0]?.id ?? "")
  const visibleRecords = useMemo(() => filterRecords(records, filters), [records, filters])
  const selectedRecord = visibleRecords.find((record) => record.id === selectedId) ?? visibleRecords[0]

  return (
    <main className="collection-shell">
      <header className="collection-header">
        <div>
          <p className="eyebrow">Home library</p>
          <h1>Vinyl Collection</h1>
        </div>
        <StatsStrip
          totalRecords={records.length}
          visibleRecords={visibleRecords.length}
          averageRating={averageRating(records)}
          highlightedShelf={filters.shelf}
        />
      </header>

      <section className="collection-layout">
        <ShelfFilters
          filters={filters}
          genres={uniqueValues(records, "genre")}
          shelves={uniqueValues(records, "shelf")}
          onFiltersChange={setFilters}
        />

        <div className="record-grid" aria-label="Records">
          {visibleRecords.map((record) => (
            <RecordCard
              key={record.id}
              record={record}
              selected={record.id === selectedRecord?.id}
              onSelect={setSelectedId}
            />
          ))}
          {visibleRecords.length === 0 && (
            <div className="empty-state">
              No records match this crate. Clear a filter or search for another artist.
            </div>
          )}
        </div>

        <aside className="now-playing">
          <p className="eyebrow">Now spinning</p>
          {selectedRecord ? (
            <>
              <div className={`turntable cover-${selectedRecord.colorway}`}>
                <span className="disc large" />
              </div>
              <h2>{selectedRecord.title}</h2>
              <p>{selectedRecord.artist}</p>
              <dl>
                <div><dt>Pressed</dt><dd>{selectedRecord.year}</dd></div>
                <div><dt>Format</dt><dd>{selectedRecord.format}</dd></div>
                <div><dt>Shelf</dt><dd>{selectedRecord.shelf}</dd></div>
                <div><dt>Played</dt><dd>{selectedRecord.lastPlayed}</dd></div>
              </dl>
            </>
          ) : (
            <p>Select a record to cue it up.</p>
          )}
        </aside>
      </section>
    </main>
  )
}
