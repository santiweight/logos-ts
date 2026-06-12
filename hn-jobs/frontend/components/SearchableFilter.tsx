import type { FC } from "react"
import { useState } from "react"

export interface FilterItem {
  label: string
  href: string
  count?: number
  active?: boolean
}

interface SearchableFilterProps {
  title: string
  items: FilterItem[]
  searchable?: boolean
  clearHref?: string | undefined
}

// A single bordered filter panel with an optional in-list search box.
// The only client state is the search query; selection itself is driven by
// URL href navigation.
export const SearchableFilter: FC<SearchableFilterProps> = ({
  title,
  items,
  searchable = false,
  clearHref,
}) => {
  const [q, setQ] = useState("")
  const filtered = q
    ? items.filter((i) => i.label.toLowerCase().includes(q.toLowerCase()))
    : items
  const anyActive = items.some((i) => i.active)

  return (
    <div className="filter-group">
      <h3>{title}</h3>
      {searchable && (
        <input
          className="filter-search"
          placeholder={`Filter ${title.toLowerCase()}…`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      )}
      <ul>
        {clearHref && anyActive && (
          <li className="clear">
            <a href={clearHref}>clear</a>
          </li>
        )}
        {filtered.map((i) => (
          <li key={i.href + i.label}>
            <a href={i.href} className={i.active ? "active" : ""}>
              {i.label}
              {typeof i.count === "number" && (
                <span className="filter-count">{i.count}</span>
              )}
            </a>
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="muted-2 small" style={{ padding: "4px 10px" }}>
            no matches
          </li>
        )}
      </ul>
    </div>
  )
}
