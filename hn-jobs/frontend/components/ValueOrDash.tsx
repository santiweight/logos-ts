import type { FC } from "react"

interface ValueOrDashProps {
  value: string | null | undefined
}

export const ValueOrDash: FC<ValueOrDashProps> = ({ value }) => {
  if (!value) {
    return <span className="muted-2">—</span>
  }
  return <>{value}</>
}
