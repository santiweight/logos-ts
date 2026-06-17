import type { FC } from "react"
import type { PortfolioSummary } from "../types"
import { formatCurrency } from "../portfolio"

interface SummaryCardsProps {
  summary: PortfolioSummary
}

export const SummaryCards: FC<SummaryCardsProps> = ({ summary }) => {
  const dayDirection = summary.dayChangeValue >= 0 ? "positive" : "negative"
  const gainDirection = summary.totalGainValue >= 0 ? "positive" : "negative"

  return (
    <section className="summary-cards" aria-label="Portfolio summary">
      <div>
        <span>{formatCurrency(summary.totalValue)}</span>
        <small>Total value</small>
      </div>
      <div className={dayDirection}>
        <span>{formatCurrency(summary.dayChangeValue)}</span>
        <small>Today</small>
      </div>
      <div className={gainDirection}>
        <span>{formatCurrency(summary.totalGainValue)}</span>
        <small>Total gain</small>
      </div>
      <div>
        <span>{formatCurrency(summary.cashBalance)}</span>
        <small>Cash</small>
      </div>
    </section>
  )
}
