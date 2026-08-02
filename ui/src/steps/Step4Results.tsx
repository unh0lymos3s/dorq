import { useMemo, useState } from 'react'
import type { BacktestResult, RunEntry } from '../types'
import Stage, { type StageState } from '../components/Stage'
import TradeChart from '../components/TradeChart'
import EquityChart from '../components/EquityChart'
import Expandable from '../components/Expandable'
import TradesTable from '../components/TradesTable'
import ChatPanel from '../components/ChatPanel'

interface Props {
  state: StageState
  result: BacktestResult | null
  runs: RunEntry[]
  activeRun: number
  onSelectRun: (idx: number) => void
  paperId: string | null
  /** True when charts are rendered in the side artifact rail instead of inline. */
  chartsDocked?: boolean
}

// All percent-kind metrics arrive from the backend as percent points
// (12.34 → 12.34%), ratios as plain floats.
const enum Kind { Percent, SignedPercent, Ratio, Integer }
interface Meta { label: string; kind: Kind }

const META: Record<string, Meta> = {
  sharpe_ratio: { label: 'Sharpe', kind: Kind.Ratio },
  sortino_ratio: { label: 'Sortino', kind: Kind.Ratio },
  max_drawdown: { label: 'Max drawdown', kind: Kind.Percent },
  win_rate: { label: 'Win rate', kind: Kind.Percent },
  num_trades: { label: 'Trades', kind: Kind.Integer },
  profit_factor: { label: 'Profit factor', kind: Kind.Ratio },
  volatility: { label: 'Volatility', kind: Kind.Percent },
  best_trade_pct: { label: 'Best trade', kind: Kind.SignedPercent },
  worst_trade_pct: { label: 'Worst trade', kind: Kind.SignedPercent },
}
const GRID_KEYS = [
  'sharpe_ratio', 'max_drawdown', 'win_rate',
  'num_trades', 'profit_factor', 'volatility',
  'sortino_ratio', 'best_trade_pct', 'worst_trade_pct',
] as const

function formatValue(meta: Meta, raw: number | string | null | undefined): string {
  if (raw == null) return '—'
  const n = typeof raw === 'string' ? Number(raw) : raw
  if (Number.isNaN(n)) return String(raw)
  switch (meta.kind) {
    case Kind.Percent: return `${n.toFixed(2)}%`
    case Kind.SignedPercent: return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
    case Kind.Integer: return String(Math.round(n))
    default: return n.toFixed(3)
  }
}

function formatSignedPct(raw: number | string | null | undefined): string {
  if (raw == null) return '—'
  const n = typeof raw === 'string' ? Number(raw) : raw
  if (Number.isNaN(n)) return String(raw)
  return n >= 0 ? `+${n.toFixed(2)}%` : `−${(-n).toFixed(2)}%`
}

export default function Step4Results({ state, result, runs, activeRun, onSelectRun, paperId, chartsDocked = false }: Props) {
  const totalReturn = result?.metrics['total_return'] ?? null
  const annReturn = result?.metrics['annualized_return'] ?? null
  const benchReturn = result?.metrics['benchmark_return'] ?? null
  const heroPositive = typeof totalReturn === 'number' ? totalReturn >= 0 : true
  const beatsBenchmark =
    typeof totalReturn === 'number' && typeof benchReturn === 'number'
      ? totalReturn >= benchReturn
      : null

  const assets = useMemo(() => Object.keys(result?.price_series ?? {}), [result?.price_series])
  const [activeAsset, setActiveAsset] = useState<string | null>(null)
  const selectedAsset = activeAsset && assets.includes(activeAsset) ? activeAsset : assets[0]
  const assetSeries = selectedAsset ? result?.price_series?.[selectedAsset] ?? [] : []
  const assetTrades = useMemo(
    () => (result?.trades ?? []).filter(t => t.asset === selectedAsset),
    [result?.trades, selectedAsset],
  )

  const hasEquity = (result?.equity_curve?.length ?? 0) > 1

  return (
    <Stage title="Results" state={state} badge={result?.backtest_id}>
      {result ? (
        <div className="card-body fade-in">
          {runs.length > 1 && (
            <>
              <span className="section-label">Runs</span>
              <div className="run-strip" role="tablist" aria-label="Backtest runs">
                {runs.map((run, i) => {
                  const tr = run.result.metrics['total_return']
                  return (
                    <button
                      key={run.result.backtest_id}
                      className={`run-pill${i === activeRun ? ' is-on' : ''}`}
                      onClick={() => onSelectRun(i)}
                    >
                      <span className="run-pill-n">#{i + 1}</span>
                      <span className="run-pill-v">{typeof tr === 'number' ? formatSignedPct(tr) : '—'}</span>
                      <span className="run-pill-l">{run.label}</span>
                    </button>
                  )
                })}
              </div>
            </>
          )}

          <div className="hero-metric">
            <div className="label">Total return</div>
            <div className={`value ${heroPositive ? 'pos' : 'neg'}`}>{formatSignedPct(totalReturn)}</div>
            <div className="sub">
              {annReturn != null && <>Annualized {formatSignedPct(annReturn)}</>}
              {benchReturn != null && (
                <>
                  {annReturn != null && ' · '}
                  Buy &amp; hold {formatSignedPct(benchReturn)}
                  {beatsBenchmark != null && (
                    <span className="bench-verdict">
                      {beatsBenchmark ? ' — strategy ahead' : ' — behind the benchmark'}
                    </span>
                  )}
                </>
              )}
            </div>
          </div>

          {hasEquity && !chartsDocked && (
            <>
              <span className="section-label">Equity vs buy &amp; hold</span>
              <Expandable title="Equity vs buy & hold">
                <EquityChart
                  equity={result.equity_curve!}
                  benchmark={result.benchmark_curve ?? []}
                  drawdown={result.drawdown_curve ?? []}
                />
              </Expandable>
            </>
          )}

          <span className="section-label">Metrics</span>
          <div className="metric-grid">
            {GRID_KEYS.map(key => (
              <div className="metric" key={key}>
                <div className="m-label">{META[key].label}</div>
                <div className="m-value">{formatValue(META[key], result.metrics[key])}</div>
              </div>
            ))}
          </div>

          {assets.length > 0 && !chartsDocked && (
            <>
              <span className="section-label">Market &amp; trades</span>
              {assets.length > 1 && (
                <div className="tabs" role="tablist">
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
              <Expandable title={`Market & trades — ${selectedAsset}`}>
                <TradeChart series={assetSeries} trades={assetTrades} />
              </Expandable>
            </>
          )}

          {(result.trades?.length ?? 0) > 0 && (
            <>
              <span className="section-label">Trade log</span>
              <TradesTable trades={result.trades!} />
            </>
          )}

          <span className="section-label">Ask the model</span>
          <ChatPanel paperId={paperId} backtestId={result.backtest_id} />
        </div>
      ) : (
        state !== 'idle' && (
          <div className="card-body">
            <div className="empty">Awaiting backtest execution</div>
          </div>
        )
      )}
    </Stage>
  )
}
