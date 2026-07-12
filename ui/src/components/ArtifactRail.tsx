import { useMemo, useState } from 'react'
import type { BacktestResult } from '../types'
import ArtifactCard from './ArtifactCard'
import EquityChart from './EquityChart'
import TradeChart from './TradeChart'

interface Props {
  result: BacktestResult
}

/**
 * Side rail of chart artifacts for the active backtest. On wide screens the
 * charts live here — pinned beside the pipeline like artifacts, each
 * downloadable as PNG/CSV — instead of inline in the results card.
 */
export default function ArtifactRail({ result }: Props) {
  const assets = useMemo(() => Object.keys(result.price_series ?? {}), [result.price_series])
  const [activeAsset, setActiveAsset] = useState<string | null>(null)
  const selectedAsset = activeAsset && assets.includes(activeAsset) ? activeAsset : assets[0]
  const assetSeries = selectedAsset ? result.price_series?.[selectedAsset] ?? [] : []
  const assetTrades = useMemo(
    () => (result.trades ?? []).filter(t => t.asset === selectedAsset),
    [result.trades, selectedAsset],
  )

  const hasEquity = (result.equity_curve?.length ?? 0) > 1
  const runId = result.backtest_id.slice(0, 8)

  const equityCsv = () => {
    const bench = new Map((result.benchmark_curve ?? []).map(p => [p.t, p.v]))
    const dd = new Map((result.drawdown_curve ?? []).map(p => [p.t, p.v]))
    const rows: (string | number | null)[][] = [['date', 'equity', 'benchmark', 'drawdown_pct']]
    for (const p of result.equity_curve ?? []) {
      rows.push([p.t, p.v, bench.get(p.t) ?? null, dd.get(p.t) ?? null])
    }
    return rows
  }

  const marketCsv = () => {
    const rows: (string | number | null)[][] = [['date', 'close']]
    for (const p of assetSeries) rows.push([p.t, p.c])
    rows.push([])
    rows.push(['side', 'entry_time', 'entry_price', 'exit_time', 'exit_price', 'pnl', 'return_pct'])
    for (const t of assetTrades) {
      rows.push([t.side, t.entry_time, t.entry_price, t.exit_time, t.exit_price, t.pnl, t.return_pct])
    }
    return rows
  }

  return (
    <aside className="artifact-rail" aria-label="Chart artifacts">
      {hasEquity && (
        <ArtifactCard
          title="Equity vs buy & hold"
          slug={`dorq-equity-${runId}`}
          csvRows={equityCsv}
        >
          <EquityChart
            equity={result.equity_curve!}
            benchmark={result.benchmark_curve ?? []}
            drawdown={result.drawdown_curve ?? []}
          />
        </ArtifactCard>
      )}

      {assets.length > 0 && (
        <ArtifactCard
          title={`Market & trades — ${selectedAsset}`}
          slug={`dorq-trades-${selectedAsset}-${runId}`}
          csvRows={marketCsv}
        >
          {assets.length > 1 && (
            <div className="tabs artifact-tabs" role="tablist">
              {assets.map(sym => (
                <button
                  key={sym}
                  className={`tab${sym === selectedAsset ? ' is-on' : ''}`}
                  onClick={() => setActiveAsset(sym)}
                >
                  {sym}
                </button>
              ))}
            </div>
          )}
          <TradeChart series={assetSeries} trades={assetTrades} />
        </ArtifactCard>
      )}
    </aside>
  )
}
