import type { Goal } from "./types"
import { CommentThread, popoverShell, type SubmitPayload, type ReplyPayload } from "./comment-ui"

interface Props {
  x: number
  y: number
  label: string
  goals: Goal[]
  workspaceKind?: "code" | "arch" | undefined
  onAdd: (text: string, mode: "code" | "arch", fork: boolean) => void
  onReply?: (goalId: string, text: string) => void
  onClose: () => void
}

export function CommentPopup({ x, y, label, goals, workspaceKind, onAdd, onReply, onClose }: Props) {
  const left = Math.min(x, window.innerWidth - 290)
  const top = Math.min(y, window.innerHeight - 280)

  const handleAdd = (p: SubmitPayload) => onAdd(p.text, p.mode, p.fork)
  const handleReply = onReply ? (p: ReplyPayload) => onReply(p.goalId, p.text) : undefined

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={{ ...popoverShell, position: "fixed", left, top }} onClick={(e) => e.stopPropagation()}>
        <CommentThread label={label} comments={goals} workspaceKind={workspaceKind} onAdd={handleAdd} onReply={handleReply} onClose={onClose} />
      </div>
    </div>
  )
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 100,
}
