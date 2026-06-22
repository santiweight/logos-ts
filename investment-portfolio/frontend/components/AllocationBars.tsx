import type { FC } from "react"
import type { Allocation } from "../types"
import { formatCurrency } from "../portfolio"

interface AllocationBarsProps {
  allocations: Allocation[]
}

export const AllocationBars: FC<AllocationBarsProps> = ({ allocations }) => {
  return (
    <section className="allocation-panel">
      <header>
        <h2>Allocation</h2>
      </header>
      <div className="allocation-list">
        {allocations.length === 0 && (
          <p className="empty-cell" role="status">No allocation data available.</p>
        )}
        {allocations.map((allocation) => (
          <div key={allocation.assetClass} className="allocation-row">
            <div className="allocation-label">
              <strong>{allocation.assetClass}</strong>
              <span>{allocation.weight.toFixed(1)}%</span>
            </div>
            <div className="allocation-track">
              <span style={{ width: `${allocation.weight}%` }} />
            </div>
            <small>{formatCurrency(allocation.value)}</small>
          </div>
        ))}
      </div>
    </section>
  )
}
