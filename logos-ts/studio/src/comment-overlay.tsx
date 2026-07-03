import React from "react"

const C = {
  fg: "#1a1a1a",
  bg: "#fff",
  accent: "#2563eb",
  highlight: "rgba(37, 99, 235, 0.12)",
}

export const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  pointerEvents: "none",
  zIndex: 2147483000,
  font: "12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace",
}

const pinStyle: React.CSSProperties = {
  position: "absolute",
  width: 22,
  height: 22,
  borderRadius: "11px 11px 11px 2px",
  border: "none",
  fontSize: 11,
  fontWeight: 700,
  cursor: "pointer",
  pointerEvents: "auto",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
  boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
}

export function Pin({
  rect,
  count,
  active,
  onClick,
}: {
  rect: DOMRect
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        ...pinStyle,
        left: rect.right - 9,
        top: rect.top - 9,
        background: active ? C.fg : C.accent,
        color: C.bg,
        outline: active ? `2px solid ${C.accent}` : "none",
      }}
      title={`${count} comment${count === 1 ? "" : "s"}`}
    >
      {count}
    </button>
  )
}

export function Highlight({ rect, label }: { rect: DOMRect; label: string }) {
  return (
    <div
      style={{
        position: "absolute",
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        border: `2px solid ${C.accent}`,
        background: C.highlight,
        borderRadius: 4,
        pointerEvents: "none",
        boxSizing: "border-box",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: -20,
          left: -2,
          background: C.fg,
          color: C.bg,
          fontSize: 10,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          padding: "2px 6px",
          borderRadius: "4px 4px 0 0",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
    </div>
  )
}

function toolbarBtnStyle(enabled: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "#27272b",
    color: enabled ? "#d4d4d8" : "#85858f",
    border: "1px solid #2e2e34",
    borderRadius: 6,
    padding: "5px 10px",
    fontSize: 11,
    fontWeight: 500,
    cursor: "pointer",
    boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    transition: "background 120ms ease, color 120ms ease",
  }
}

const countPill: React.CSSProperties = {
  background: "#4a9eff",
  color: "#fff",
  borderRadius: 9,
  padding: "0 5px",
  fontSize: 10,
  minWidth: 14,
  textAlign: "center",
  fontWeight: 600,
}

const hintBox: React.CSSProperties = {
  background: "#27272b",
  border: "1px solid #2e2e34",
  borderRadius: 6,
  padding: "4px 8px",
  fontSize: 10,
  color: "#85858f",
  boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
}

const kbd: React.CSSProperties = {
  background: "#2e2e34",
  border: "1px solid #3a3a42",
  borderRadius: 3,
  padding: "1px 5px",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 10,
  color: "#d4d4d8",
}

export function CommentToolbar({
  enabled,
  onToggle,
  total,
  altDown,
}: {
  enabled: boolean
  onToggle: () => void
  total: number
  altDown: boolean
}) {
  return (
    <div
      style={{
        position: "absolute",
        bottom: 14,
        right: 14,
        display: "flex",
        alignItems: "center",
        gap: 8,
        pointerEvents: "auto",
      }}
    >
      {enabled && (
        <span style={hintBox}>
          <kbd style={kbd}>Alt</kbd>
          {altDown ? " + click" : " + hover"}
        </span>
      )}
      <button
        type="button"
        onClick={onToggle}
        style={toolbarBtnStyle(enabled)}
        title={enabled ? "Comments on — click to disable" : "Comments off"}
      >
        {total > 0 && <span style={countPill}>{total}</span>}
        {enabled ? "Comments" : "Off"}
      </button>
    </div>
  )
}
