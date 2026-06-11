import type { FC, ReactNode } from "react"
import { useState } from "react"

interface FiltersSidebarProps {
  activeCount: number
  children: ReactNode
}

// Wraps the filter panels. On desktop it's always visible; on mobile it
// collapses behind a toggle button.
export const FiltersSidebar: FC<FiltersSidebarProps> = ({ activeCount, children }) => {
  const [open, setOpen] = useState(false)

  return (
    <aside className="filters-sidebar">
      <button
        className="filters-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {activeCount > 0 && <span className="filters-active-dot" />}
        Filters{activeCount > 0 ? ` (${activeCount})` : ""} {open ? "▲" : "▼"}
      </button>
      <div className={`filters-content${open ? " open" : ""}`}>{children}</div>
    </aside>
  )
}
