/* eslint-disable no-restricted-syntax */
import { type FC } from "react"
import type { Job } from "../../shared/types"
import { SearchableFilter, type FilterItem } from "../components/SearchableFilter"
import { FiltersSidebar } from "../components/FiltersSidebar"
import { JobTable } from "../components/JobTable"

// Pure props-down view: it renders the jobs it is given. Search filtering is a
// backend concern (jobMatchesFilters); the search box just reports the query up.
interface DirectoryViewProps {
  jobs: Job[]
  sortItems: FilterItem[]
  flagItems: FilterItem[]
  familyItems: FilterItem[]
  seniorityItems: FilterItem[]
  regionItems: FilterItem[]
  applyItems: FilterItem[]
  salaryItems: FilterItem[]
  tagItems: FilterItem[]
  monthItems: FilterItem[]
  activeCount: number
  searchQuery: string
  onSearchChange?: (query: string) => void
}

export const DirectoryView: FC<DirectoryViewProps> = ({
  jobs,
  sortItems,
  flagItems,
  familyItems,
  seniorityItems,
  regionItems,
  applyItems,
  salaryItems,
  tagItems,
  monthItems,
  activeCount,
  searchQuery,
  onSearchChange,
}) => {

  return (
    <div className="layout">
      <FiltersSidebar activeCount={activeCount}>
        <input
          className="searchbox"
          type="text"
          placeholder="Search postings…"
          value={searchQuery}
          onChange={(e) => onSearchChange?.(e.target.value)}
        />
        <SearchableFilter title="Sort" items={sortItems} />
        <SearchableFilter title="Filters" items={flagItems} />
        <SearchableFilter
          title="Role"
          items={familyItems}
          searchable
          clearHref={familyItems.some((i) => i.active) ? "/" : undefined}
        />
        <SearchableFilter
          title="Seniority"
          items={seniorityItems}
          searchable={seniorityItems.length > 8}
          clearHref={seniorityItems.some((i) => i.active) ? "/" : undefined}
        />
        <SearchableFilter
          title="Region"
          items={regionItems}
          searchable={regionItems.length > 8}
          clearHref={regionItems.some((i) => i.active) ? "/" : undefined}
        />
        <SearchableFilter
          title="Apply"
          items={applyItems}
          clearHref={applyItems.some((i) => i.active) ? "/" : undefined}
        />
        <SearchableFilter
          title="Comp"
          items={salaryItems}
          clearHref={salaryItems.some((i) => i.active) ? "/" : undefined}
        />
        <SearchableFilter
          title="Tech"
          items={tagItems}
          searchable
          clearHref={tagItems.some((i) => i.active) ? "/" : undefined}
        />
        <SearchableFilter
          title="Month"
          items={monthItems}
          searchable={monthItems.length > 8}
        />
      </FiltersSidebar>

      <main>
        <JobTable jobs={jobs} />
      </main>
    </div>
  )
}
