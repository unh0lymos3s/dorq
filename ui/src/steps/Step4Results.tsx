import { useMemo } from 'react'
import type { BacktestResult } from '../types'
import Stage, { type StageState } from '../components/Stage'

interface Props {
  state: StageState
  result: BacktestResult | null
}

const enum Kind { Percent, Ratio, Integer }
interface Meta { label: string; kind: Kind }

const META: Record<string, Meta> = {
  sharpe_ratio: { label: 'Sharpe', kind: Kind.Ratio },
  max_drawdown: { label: 'Max drawdown', kind: Kind.Percent },
  win_rate: { label: 'Win rate', kind: Kind.Percent },
  total_trades: { label: 'Trades', kind: Kind.Integer },
  calmar_ratio: { label: 'Calmar', kind: Kind.Ratio },
  volatility: { label: 'Volatility', kind: Kind.Percent },
}
const GRID_KEYS = ['sharpe_ratio', 'max_drawdown', 'win_rate', 'total_trades', 'calmar_ratio', 'volatility'] as const

function formatValue(meta: Meta, raw: number | string | null | undefined): string {
  if (raw == null) return '—'
  const n = typeof raw === 'string' ? Number(raw) : raw
  if (Number.isNaN(n)) return String(raw)
  switch (meta.kind) {
    case Kind.Percent: return `${(n * 100).toFixed(2)}%`
    case Kind.Integer: return String(Math.round(n))
    default: return n.toFixed(3)
  }
}

function formatHero(raw: number | string | null | undefined): string {
  if (raw == null) return '—'
  const n = typeof raw === 'string' ? Number(raw) : raw
  if (Number.isNaN(n)) return String(raw)
  const v = n * 100
  return v >= 0 ? `+${v.toFixed(2)}%` : `−${(-v).toFixed(2)}%`
}

export default function Step4Results({ state, result }: Props) {
  const totalReturn = result?.metrics['total_return'] ?? null
  const annReturn = result?.metrics['annualized_return'] ?? null
  const heroPositive = typeof totalReturn === 'number' ? totalReturn >= 0 : true

  const chartSources = useMemo(() => {
    if (!result?.charts?.length) return null
    return result.charts.map(b64 => `data:image/png;base64,${b64}`)
  }, [result?.charts])

  return (
    <Stage n={4} title="Results" state={state} badge={result?.backtest_id} last>
      {result ? (
        <div className="card-body fade-in">
          <div className="hero-metric">
            <div className="label">Total return</div>
            <div className={`value ${heroPositive ? 'pos' : 'neg'}`}>{formatHero(totalReturn)}</div>
            {annReturn != null && <div className="sub">Annualized {formatHero(annReturn)}</div>}
          </div>

          <span className="section-label">Metrics</span>
          <div className="metric-grid">
            {GRID_KEYS.map(key => (
              <div className="metric" key={key}>
                <div className="m-label">{META[key].label}</div>
                <div className="m-value">{formatValue(META[key], result.metrics[key])}</div>
              </div>
            ))}
          </div>

          {chartSources && (
            <>
              <span className="section-label">Charts</span>
              <div className="chart-list">
                {chartSources.map((src, i) => (
                  <img key={i} src={src} alt={`Chart ${i + 1}`} className="chart" loading="lazy" decoding="async" />
                ))}
              </div>
            </>
          )}
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
