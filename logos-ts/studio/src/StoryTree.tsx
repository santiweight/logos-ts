import type { ComponentEntry, Selection } from "./types"

import type { DiffStatus } from "./types"

interface Props {
  components: ComponentEntry[]
  selection: Selection
  active: boolean
  expanded: Set<string>
  onSelect: (sel: Selection) => void
  onToggle: (name: string) => void
  diff: Record<string, DiffStatus>
}

export function StoryTree({ components, selection, active, expanded, onSelect, onToggle, diff }: Props) {
  return (
    <nav className="tree">
      <div className="tree-title">COMPONENTS</div>
      {components.map((c) => {
        const isOpen = expanded.has(c.name)
        const isComp = active && selection.comp === c.name && selection.view === "code"
        const status =
          diff[`component:${c.name}`] ?? (c.propsName ? diff[`props:${c.propsName}`] : undefined)
        return (
          <div key={c.name}>
            <div
              className={`node comp ${isComp ? "active" : ""} ${status ? `diff-${status}` : ""}`}
              onClick={() => {
                if (!isOpen) onToggle(c.name)
                onSelect({ comp: c.name, view: "code" })
              }}
            >
              <span
                className="caret"
                onClick={(e) => {
                  e.stopPropagation()
                  onToggle(c.name)
                }}
              >
                {isOpen ? "▾" : "▸"}
              </span>
              <span className="label">{c.name}</span>
              <span className="count">{c.stories.length}</span>
            </div>
            {isOpen && (
              <div className="children">
                {c.stories.map((s) => (
                  <div
                    key={s.id}
                    className={`node story ${
                      active && selection.view === "story" && selection.storyId === s.id ? "active" : ""
                    }`}
                    onClick={() => onSelect({ comp: c.name, view: "story", storyId: s.id })}
                  >
                    <span className="glyph">◆</span>
                    <span className="label">{s.exportName}</span>
                  </div>
                ))}
                {c.captured.map((cap) => (
                  <div
                    key={cap.exportName}
                    className={`node captured ${
                      active && selection.view === "captured" && selection.exportName === cap.exportName
                        ? "active"
                        : ""
                    }`}
                    onClick={() =>
                      onSelect({ comp: c.name, view: "captured", exportName: cap.exportName })
                    }
                  >
                    <span className="glyph ok">✓</span>
                    <span className="label">
                      {cap.exportName} <em>⟨captured⟩</em>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </nav>
  )
}
