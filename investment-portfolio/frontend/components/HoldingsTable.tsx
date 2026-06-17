import type { FC } from "react"
import type { Holding } from "../types"
import {
  formatCurrency,
  formatPercent,
  holdingGainPercent,
  holdingGainValue,
  holdingValue,
  holdingWeight,
} from "../portfolio"

interface HoldingsTableProps {
  holdings: Holding[]
  totalValue: number
  selectedHoldingId?: string | undefined
  onHoldingSelect?: ((id: string) => void) | undefined
}

export const HoldingsTable: FC<HoldingsTableProps> = ({
  holdings,
  totalValue,
  selectedHoldingId,
  onHoldingSelect,
}) => {
  return (
    <section className="holdings-panel">
      <header>
        <h2>Holdings</h2>
        <span>{holdings.length}</span>
      </header>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Name</th>
              <th>Class</th>
              <th className="num">Shares</th>
              <th className="num">Value</th>
              <th className="num">Gain</th>
              <th className="num">Weight</th>
            </tr>
          </thead>
          <tbody>
            {holdings.map((holding) => {
              const gain = holdingGainPercent(holding)
              return (
                <tr
                  key={holding.id}
                  className={holding.id === selectedHoldingId ? "selected" : ""}
                  onClick={() => onHoldingSelect?.(holding.id)}
                >
                  <td><strong>{holding.symbol}</strong></td>
                  <td>{holding.name}</td>
                  <td>{holding.assetClass}</td>
                  <td className="num">{holding.shares.toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
                  <td className="num">{formatCurrency(holdingValue(holding))}</td>
                  <td className={`num ${gain >= 0 ? "positive" : "negative"}`}>
                    {formatCurrency(holdingGainValue(holding))} <span>{formatPercent(gain)}</span>
                  </td>
                  <td className="num">{holdingWeight(holding, totalValue).toFixed(1)}%</td>
                </tr>
              )
            })}
            {holdings.length === 0 && (
              <tr>
                <td colSpan={7} className="empty-cell">No holdings match these filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
