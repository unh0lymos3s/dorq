import { useMemo } from 'react'
import type React from 'react'
import type { BacktestResult } from '../types'

interface Props {
  result: BacktestResult | null
  active: boolean
  animKey?: number
}

// Metric kinds — use plain object lookup (one hashmap probe) instead of three Set.has() calls.
const enum MetricKind { Percent, Ratio, Integer }

interface MetricMeta {
  label: string
  kind: MetricKind
}

const METRIC_META: Record<string, MetricMeta> = {
  total_return:      { label: 'Total Return',   kind: MetricKind.Percent },
  annualized_return: { label: 'Ann. Return',    kind: MetricKind.Percent },
  sharpe_ratio:      { label: 'Sharpe Ratio',   kind: MetricKind.Ratio },
  max_drawdown:      { label: 'Max Drawdown',   kind: MetricKind.Percent },
  win_rate:          { label: 'Win Rate',       kind: MetricKind.Percent },
  total_trades:      { label: 'Total Trades',   kind: MetricKind.Integer },
  calmar_ratio:      { label: 'Calmar Ratio',   kind: MetricKind.Ratio },
  volatility:        { label: 'Volatility',     kind: MetricKind.Percent },
}

// Grid order excludes the two hero metrics.
const GRID_KEYS = [
  'sharpe_ratio',
  'max_drawdown',
  'win_rate',
  'total_trades',
  'calmar_ratio',
  'volatility',
] as const

function formatValue(meta: MetricMeta, raw: number | null | undefined): string {
  if (raw == null) return '—'
  switch (meta.kind) {
    case MetricKind.Percent: return `${(raw * 100).toFixed(2)}%`
    case MetricKind.Integer: return String(Math.round(raw))
    case MetricKind.Ratio:
    default: return raw.toFixed(3)
  }
}

function formatHeroReturn(raw: number | null | undefined): string {
  if (raw == null) return '—'
  const v = raw * 100
  return v >= 0 ? `+${v.toFixed(2)}%` : `−${(-v).toFixed(2)}%`
}

// ─── Module-scope style constants ──────────────────────────────────────────
const CARD_ACTIVE: React.CSSProperties = { border: '2px solid var(--text)', position: 'relative', zIndex: 1, marginTop: -1, overflow: 'hidden' }
const CARD_DONE: React.CSSProperties = { border: '1px solid var(--border)', marginTop: -1, overflow: 'hidden' }
const CARD_IDLE: React.CSSProperties = { border: '1px solid var(--border)', marginTop: -1, overflow: 'hidden', opacity: 0.4 }

const HEADER_BASE: React.CSSProperties = {
  height: 52, padding: '0 20px', display: 'flex', alignItems: 'center', gap: 16,
}
const HEADER_ACTIVE: React.CSSProperties = { ...HEADER_BASE, background: 'var(--bg)' }
const HEADER_IDLE: React.CSSProperties = { ...HEADER_BASE, background: 'var(--surface)' }

const STEP_NUM_ACTIVE: React.CSSProperties = { fontSize: 28, fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--font)', lineHeight: 1, flexShrink: 0 }
const STEP_NUM_DONE: React.CSSProperties = { fontSize: 20, fontWeight: 800, color: 'var(--muted)', fontFamily: 'var(--font)', lineHeight: 1, textDecoration: 'line-through', flexShrink: 0 }
const STEP_NUM_IDLE: React.CSSProperties = { fontSize: 28, fontWeight: 800, color: 'var(--subtle)', fontFamily: 'var(--font)', lineHeight: 1, flexShrink: 0 }

const TITLE_STYLE: React.CSSProperties = {
  fontSize: 13, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
  color: 'var(--text)', flex: 1,
}

const SECTION_LABEL_STYLE: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase',
  color: 'var(--muted)', paddingBottom: 10, marginBottom: 0, borderBottom: '1px solid var(--border)',
  display: 'block',
}

const BODY_DONE_STYLE: React.CSSProperties = {
  borderTop: '1px solid var(--border)', padding: '20px 20px 24px', animation: 'fadeIn 0.4s ease',
}
const BODY_EMPTY_STYLE: React.CSSProperties = {
  borderTop: '1px solid var(--border)', padding: '20px 20px 24px', animation: 'slideDown 0.22s ease',
}

const HERO_WRAP_STYLE: React.CSSProperties = {
  borderBottom: '1px solid var(--border)', padding: '20px 0 24px', marginBottom: 24,
}
const HERO_LABEL_STYLE: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase',
  color: 'var(--muted)', marginBottom: 8,
}
const HERO_VALUE_STYLE: React.CSSProperties = {
  fontSize: 52, fontWeight: 800, fontFamily: 'var(--font)', color: 'var(--text)',
  lineHeight: 1, marginBottom: 8,
}
const HERO_SUB_STYLE: React.CSSProperties = {
  fontSize: 13, fontFamily: 'var(--mono)', color: 'var(--muted)',
}

const GRID_STYLE: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0,
  border: '1px solid var(--border)', marginBottom: 32,
}

const CELL_LABEL_STYLE: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
  color: 'var(--muted)', marginBottom: 6,
}
const CELL_VALUE_STYLE: React.CSSProperties = {
  fontSize: 22, fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--text)',
}

// Pre-built per-cell border style cache — there are only four possibilities
// (right/not-right × last-row/not-last-row).
const CELL_PAD: React.CSSProperties = { padding: '14px 16px' }
const CELL_TL: React.CSSProperties = { ...CELL_PAD, borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }
const CELL_TR: React.CSSProperties = { ...CELL_PAD, borderBottom: '1px solid var(--border)' }
const CELL_BL: React.CSSProperties = { ...CELL_PAD, borderRight: '1px solid var(--border)' }
const CELL_BR: React.CSSProperties = CELL_PAD

const CHARTS_WRAP_STYLE: React.CSSProperties = { display: 'flex', flexDirection: 'column' }
const CHART_IMG_STYLE: React.CSSProperties = {
  border: '1px solid var(--border)', marginTop: 16, width: '100%', display: 'block',
}

const BADGE_STYLE: React.CSSProperties = {
  fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--mono)', letterSpacing: '0.04em',
}

const EMPTY_STATE_STYLE: React.CSSProperties = {
  padding: '32px 0', textAlign: 'center', fontSize: 11, letterSpacing: '0.1em',
  textTransform: 'uppercase', color: 'var(--muted)',
}

export default function Step4Results({ result, active }: Props) {
  const isDone = result !== null
  const isActive = active

  const cardStyle = isActive ? CARD_ACTIVE : isDone ? CARD_DONE : CARD_IDLE
  const headerStyle = isActive ? HEADER_ACTIVE : HEADER_IDLE
  const stepNumberStyle = isActive ? STEP_NUM_ACTIVE : isDone ? STEP_NUM_DONE : STEP_NUM_IDLE

  const totalReturn = result?.metrics['total_return'] ?? null
  const annReturn = result?.metrics['annualized_return'] ?? null

  // Memoize chart data URIs by reference — when `result.charts` is the same
  // array, we don't reallocate the strings (each is ~hundreds of KB).
  const chartSources = useMemo(() => {
    if (!result?.charts?.length) return null
    return result.charts.map(b64 => `data:image/png;base64,${b64}`)
  }, [result?.charts])

  // Build grid cells once per result; avoids the per-render i%2 / >=len-2 math
  // and lets us pick from the cached border styles.
  const gridCells = useMemo(() => {
    if (!result) return null
    const total = GRID_KEYS.length
    return GRID_KEYS.map((key, i) => {
      const meta = METRIC_META[key]
      const raw = result.metrics[key]
      const isRightCol = (i & 1) === 1
      const isLastRow = i >= total - 2
      const cellStyle = isLastRow
        ? (isRightCol ? CELL_BR : CELL_BL)
        : (isRightCol ? CELL_TR : CELL_TL)
      return (
        <div key={key} style={cellStyle}>
          <div style={CELL_LABEL_STYLE}>{meta.label}</div>
          <div style={CELL_VALUE_STYLE}>{formatValue(meta, raw)}</div>
        </div>
      )
    })
  }, [result])

  return (
    <div style={cardStyle} className={active && result !== null ? 'step-active' : undefined}>
      <div style={headerStyle}>
        <span style={stepNumberStyle}>4</span>
        <span style={TITLE_STYLE}>Results</span>
        {isDone && result && <span style={BADGE_STYLE}>{result.backtest_id}</span>}
      </div>

      {isActive && result && (
        <div style={BODY_DONE_STYLE}>
          {/* Hero metric */}
          <div style={HERO_WRAP_STYLE}>
            <div style={HERO_LABEL_STYLE}>Total Return</div>
            <div style={HERO_VALUE_STYLE}>{formatHeroReturn(totalReturn)}</div>
            {annReturn != null && (
              <div style={HERO_SUB_STYLE}>Annualized: {formatHeroReturn(annReturn)}</div>
            )}
          </div>

          <span style={SECTION_LABEL_STYLE}>Metrics</span>

          <div style={GRID_STYLE}>{gridCells}</div>

          {chartSources && (
            <>
              <span style={SECTION_LABEL_STYLE}>Charts</span>
              <div style={CHARTS_WRAP_STYLE}>
                {chartSources.map((src, i) => (
                  <img
                    key={i}
                    src={src}
                    alt={`Chart ${i + 1}`}
                    style={CHART_IMG_STYLE}
                    loading="lazy"
                    decoding="async"
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {isActive && !result && (
        <div style={BODY_EMPTY_STYLE}>
          <div style={EMPTY_STATE_STYLE}>Awaiting backtest execution</div>
        </div>
      )}
    </div>
  )
}
