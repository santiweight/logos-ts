import React, { type ReactNode } from "react"

export const svgIcon = (d: string, size = 14) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: "-2px", flexShrink: 0 }}>
    <path d={d} />
  </svg>
)

export const ICONS = {
  dir: svgIcon("M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"),
  file: svgIcon("M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6"),
  fn: "ƒ",
  cls: "⬚",
  comp: svgIcon("M16 18l6-6-6-6M8 6l-6 6 6 6"),
  story: "◆",
  captured: "✓",
} as const satisfies Record<string, ReactNode>

export type IconKind = keyof typeof ICONS

export function iconForLabel(label: string): ReactNode {
  if (label.startsWith("ƒ ") || label.startsWith("fn:")) return ICONS.fn
  if (label.startsWith("⬚ ") || label.startsWith("cls:") || label.startsWith("class:")) return ICONS.cls
  if (label.startsWith("<") || label.startsWith("component:")) return ICONS.comp
  if (label.startsWith("test:") || label.startsWith("test ")) return ICONS.captured
  if (label.startsWith("· ") || label.startsWith("method:")) return ICONS.fn
  return ICONS.file
}
