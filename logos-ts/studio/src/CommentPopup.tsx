import { useEffect } from "react"
import type { Goal } from "./types"
import {
  CommentThread,
  applyPopoverDragOffset,
  popoverShell,
  usePopoverDrag,
  type ReplyPayload,
  type SubmitPayload,
} from "./comment-ui"

interface Props {
  x: number
  y: number
  label: string
  goals: Goal[]
  workspaceKind?: "code" | "arch" | undefined
  onAdd: (text: string, mode: "code" | "arch", fork: boolean, autoMerge: boolean) => void
  onReply?: (goalId: string, text: string) => void
  onClose: () => void
}

export function CommentPopup({ x, y, label, goals, workspaceKind, onAdd, onReply, onClose }: Props) {
  const left = Math.min(x, window.innerWidth - 290)
  const top = Math.min(y, window.innerHeight - 280)
  const { offset, reset, dragHandleProps } = usePopoverDrag()

  const handleAdd = (p: SubmitPayload) => onAdd(p.text, p.mode, p.fork, p.autoMerge)
  const replyProps = onReply == null
    ? {}
    : { onReply: (p: ReplyPayload) => onReply(p.goalId, p.text) }

  useEffect(() => {
    reset()
  }, [label, reset, x, y])

  return (
    <div style={overlayStyle}>
      <div
        style={{
          ...popoverShell,
          position: "fixed",
          pointerEvents: "auto",
          ...applyPopoverDragOffset({ left, top }, offset),
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <CommentThread
          label={label}
          comments={goals}
          workspaceKind={workspaceKind}
          onAdd={handleAdd}
          {...replyProps}
          onClose={onClose}
          dragHandleProps={dragHandleProps}
        />
      </div>
    </div>
  )
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 100,
  pointerEvents: "none",
}
