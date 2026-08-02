import { useMemo, useState } from 'react'
import type { BacktestResult } from '../types'
import ArtifactCard from './ArtifactCard'
import EquityChart from './EquityChart'
import DrawdownChart from './DrawdownChart'
import TradeChart from './TradeChart'

interface Props {
  result: BacktestResult
}

type ChartKey = 'equity' | 'drawdown' | 'market'

const LABEL: Record<ChartKey, string> = {
  equity: 'Equity',
  drawdown: 'Drawdown',
  market: 'Market & trades',
}

/** Grid glyphs for the 1 / 2 / 3-chart layout buttons. */
const LAYOUT_ICONS: Record<1 | 2 | 3, JSX.Element> = {
  1: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="2" />
    </svg>
  ),
  2: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="4" y="3" width="16" height="8" rx="2" /><rect x="4" y="13" width="16" height="8" rx="2" />
    </svg>
  ),
  3: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="4" y="2" width="16" height="5.4" rx="1.6" /><rect x="4" y="9.3" width="16" height="5.4" rx="1.6" /><rect x="4" y="16.6" width="16" height="5.4" rx="1.6" />
    </svg>
  ),
}

/**
 * The chart half of the screen on wide viewports: a toolbar with per-chart
 * toggles (single view) and 1/2/3-up layout buttons, over stacked chart
 * panels — each fullscreenable, zoomable, and downloadable as PNG/CSV.
 */
export default function ChartWorkspace({ result }: Props) {
  const assets = useMemo(() => Object.keys(result.price_series ?? {}), [result.price_series])
  const [activeAsset, setActiveAsset] = useState<string | null>(null)
  const selectedAsset = activeAsset && assets.includes(activeAsset) ? activeAsset : assets[0]
  const assetSeries = selectedAsset ? result.price_series?.[selectedAsset] ?? [] : []
  const assetTrades = useMemo(
    () => (result.trades ?? []).filter(t => t.asset === selectedAsset),
    [result.trades, selectedAsset],
  )

  const hasEquity = (result.equity_curve?.length ?? 0) > 1
  const hasDrawdown = (result.drawdown_curve?.length ?? 0) > 1
  const runId = result.backtest_id.slice(0, 8)

  // 2-up favours equity + market; drawdown joins at 3-up.
  const available = useMemo<ChartKey[]>(() => [
    ...(hasEquity ? (['equity'] as const) : []),
    ...(assets.length > 0 ? (['market'] as const) : []),
    ...(hasDrawdown ? (['drawdown'] as const) : []),
  ], [hasEquity, hasDrawdown, assets.length])

  const [layout, setLayout] = useState<1 | 2 | 3>(1)
  const [active, setActive] = useState<ChartKey>('equity')

  const activeKey = available.includes(active) ? active : available[0]
  const count = Math.min(layout, available.length) as 1 | 2 | 3
  const visible = count === 1 ? [activeKey] : available.slice(0, count)

  const equityCsv = () => {
    const bench = new Map((result.benchmark_curve ?? []).map(p => [p.t, p.v]))
    const dd = new Map((result.drawdown_curve ?? []).map(p => [p.t, p.v]))
    const rows: (string | number | null)[][] = [['date', 'equity', 'benchmark', 'drawdown_pct']]
    for (const p of result.equity_curve ?? []) {
      rows.push([p.t, p.v, bench.get(p.t) ?? null, dd.get(p.t) ?? null])
    }
    return rows
  }

  const drawdownCsv = () => {
    const rows: (string | number | null)[][] = [['date', 'drawdown_pct']]
    for (const p of result.drawdown_curve ?? []) rows.push([p.t, p.v])
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

  const renderPanel = (key: ChartKey) => {
    switch (key) {
      case 'equity':
        return (
          <ArtifactCard key="equity" title="Equity vs buy & hold" slug={`dorq-equity-${runId}`} csvRows={equityCsv}>
            <EquityChart
              variant="equity"
              equity={result.equity_curve!}
              benchmark={result.benchmark_curve ?? []}
              drawdown={result.drawdown_curve ?? []}
            />
          </ArtifactCard>
        )
      case 'drawdown':
        return (
          <ArtifactCard key="drawdown" title="Drawdown" slug={`dorq-drawdown-${runId}`} csvRows={drawdownCsv}>
            <DrawdownChart drawdown={result.drawdown_curve!} />
          </ArtifactCard>
        )
      case 'market':
        return (
          <ArtifactCard
            key="market"
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
        )
    }
  }

  if (available.length === 0) return null

  return (
    <aside className="chart-workspace" aria-label="Chart workspace">
      <div className="cw-toolbar">
        <div className="tabs cw-tabs" role="tablist" aria-label="Chart selection">
          {available.map(k => (
            <button
              key={k}
              className={`tab${count === 1 && k === activeKey ? ' is-on' : ''}`}
              onClick={() => { setActive(k); setLayout(1) }}
            >
              {LABEL[k]}
            </button>
          ))}
        </div>
        <div className="cw-layouts" role="group" aria-label="Charts shown at once">
          {([1, 2, 3] as const).map(k => (
            <button
              key={k}
              className={`cw-layout-btn${count === k ? ' is-on' : ''}`}
              disabled={available.length < k}
              onClick={() => setLayout(k)}
              title={k === 1 ? 'One chart' : `${k} charts at once`}
              aria-label={k === 1 ? 'Show one chart' : `Show ${k} charts at once`}
            >
              {LAYOUT_ICONS[k]}
            </button>
          ))}
        </div>
      </div>
      <div className={`cw-panels cw-${visible.length}`}>
        {visible.map(renderPanel)}
      </div>
    </aside>
  )
}
