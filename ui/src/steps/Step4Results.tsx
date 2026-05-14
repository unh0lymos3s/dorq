import type React from 'react'
import type { BacktestResult } from '../types'

interface Props {
  result: BacktestResult | null
  active: boolean
}

const CIRCLE: React.CSSProperties = {
  width: 24,
  height: 24,
  borderRadius: '50%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 11,
  fontWeight: 700,
  flexShrink: 0,
  background: 'var(--text)',
  color: 'var(--bg)',
  border: 'none',
}

const CIRCLE_IDLE: React.CSSProperties = {
  ...CIRCLE,
  background: 'transparent',
  color: 'var(--muted)',
  border: '1.5px solid var(--border)',
}

const METRIC_KEYS = [
  'total_return',
  'annualized_return',
  'sharpe_ratio',
  'max_drawdown',
  'win_rate',
  'total_trades',
  'calmar_ratio',
  'volatility',
] as const

type MetricKey = typeof METRIC_KEYS[number]

const METRIC_LABELS: Record<MetricKey, string> = {
  total_return: 'Total Return',
  annualized_return: 'Ann. Return',
  sharpe_ratio: 'Sharpe Ratio',
  max_drawdown: 'Max Drawdown',
  win_rate: 'Win Rate',
  total_trades: 'Total Trades',
  calmar_ratio: 'Calmar Ratio',
  volatility: 'Volatility',
}

const PERCENTAGE_KEYS: Set<MetricKey> = new Set([
  'total_return',
  'annualized_return',
  'max_drawdown',
  'win_rate',
  'volatility',
])

const RATIO_KEYS: Set<MetricKey> = new Set([
  'sharpe_ratio',
  'calmar_ratio',
])

const INTEGER_KEYS: Set<MetricKey> = new Set([
  'total_trades',
])

function formatValue(key: MetricKey, raw: number | null | undefined): string {
  if (raw == null) return '—'
  if (PERCENTAGE_KEYS.has(key)) {
    return `${(raw * 100).toFixed(2)}%`
  }
  if (RATIO_KEYS.has(key)) {
    return raw.toFixed(3)
  }
  if (INTEGER_KEYS.has(key)) {
    return String(Math.round(raw))
  }
  return raw.toFixed(3)
}

export default function Step4Results({ result, active }: Props) {
  const isDone = result !== null
  const isActive = active

  const cardStyle: React.CSSProperties = {
    border: isActive
      ? '2px solid var(--text)'
      : '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    overflow: 'hidden',
    opacity: !active ? 0.45 : 1,
  }

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '12px 16px',
    background: 'var(--surface)',
  }

  const cirStyle = isDone || isActive ? CIRCLE : CIRCLE_IDLE

  const metricGrid: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 10,
    marginBottom: 20,
  }

  const metricCard: React.CSSProperties = {
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    padding: '10px 12px',
    background: 'var(--subtle)',
    minWidth: 0,
  }

  const metricLabel: React.CSSProperties = {
    fontSize: 11,
    color: 'var(--muted)',
    marginBottom: 4,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
    fontWeight: 500,
  }

  const metricValue: React.CSSProperties = {
    fontSize: 20,
    fontWeight: 700,
    color: 'var(--text)',
    fontFamily: 'var(--mono)',
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  }

  return (
    <div style={cardStyle}>
      <div style={headerStyle}>
        <div style={cirStyle}>{isDone ? '✓' : '4'}</div>
        <span style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>Results</span>
        {isDone && result && (
          <span style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
            {result.backtest_id}
          </span>
        )}
      </div>

      {isActive && result && (
        <div style={{ padding: '0 16px 20px' }}>
          {/* Metrics grid */}
          <div style={{ marginBottom: 8, marginTop: 12 }}>
            <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              Metrics
            </span>
          </div>
          <div style={metricGrid}>
            {METRIC_KEYS.map(key => {
              const raw = result.metrics[key]
              return (
                <div key={key} style={metricCard}>
                  <div style={metricLabel}>{METRIC_LABELS[key]}</div>
                  <div style={metricValue}>{formatValue(key, raw)}</div>
                </div>
              )
            })}
          </div>

          {/* Charts */}
          {result.charts.length > 0 && (
            <>
              <div style={{ marginBottom: 10 }}>
                <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                  Charts
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {result.charts.map((b64, i) => (
                  <img
                    key={i}
                    src={`data:image/png;base64,${b64}`}
                    alt={`Chart ${i + 1}`}
                    style={{
                      width: '100%',
                      borderRadius: 'var(--radius)',
                      border: '1px solid var(--border)',
                      display: 'block',
                    }}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {isActive && !result && (
        <div style={{ padding: '12px 16px 16px' }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>
            Run a backtest to see results here.
          </p>
        </div>
      )}
    </div>
  )
}
