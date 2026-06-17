import type { FC } from "react"
import type { Holding } from "../types"
import { formatCurrency, formatPercent, holdingGainPercent, holdingGainValue, holdingValue } from "../portfolio"

interface HoldingDetailProps {
  holding?: Holding | undefined
}

export const HoldingDetail: FC<HoldingDetailProps> = ({ holding }) => {
  if (!holding) {
    return (
      <aside className="holding-detail">
        <p className="eyebrow">Selected holding</p>
        <p>No holding selected.</p>
      </aside>
    )
  }

  const gain = holdingGainPercent(holding)

  return (
    <aside className="holding-detail">
      <p className="eyebrow">Selected holding</p>
      <h2>{holding.symbol}</h2>
      <h3>{holding.name}</h3>
      <dl>
        <div><dt>Value</dt><dd>{formatCurrency(holdingValue(holding))}</dd></div>
        <div><dt>Price</dt><dd>{formatCurrency(holding.price)}</dd></div>
        <div><dt>Average cost</dt><dd>{formatCurrency(holding.averageCost)}</dd></div>
        <div><dt>Gain/loss</dt><dd className={gain >= 0 ? "positive" : "negative"}>{formatCurrency(holdingGainValue(holding))} {formatPercent(gain)}</dd></div>
      </dl>
      <section>
        <h4>Notes</h4>
        <p>{holding.notes}</p>
      </section>
    </aside>
  )
}
