/* eslint-disable @typescript-eslint/no-confusing-void-expression */
import type { Goal } from "./types"
import { CommentThread, popoverShell, type SubmitPayload } from "./comment-ui"

interface Props {
  x: number
  y: number
  label: string
  goals: Goal[]
  onAdd: (text: string, mode: "code" | "arch", fork: boolean) => void
  onClose: () => void
}

export function CommentPopup({ x, y, label, goals, onAdd, onClose }: Props) {
  const left = Math.min(x, window.innerWidth - 290)
  const top = Math.min(y, window.innerHeight - 280)

  const handleAdd = (p: SubmitPayload) => onAdd(p.text, p.mode, p.fork)

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={{ ...popoverShell, position: "fixed", left, top }} onClick={(e) => e.stopPropagation()}>
        <CommentThread label={label} comments={goals} onAdd={handleAdd} onClose={onClose} />
      </div>
    </div>
  )
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 100,
}
