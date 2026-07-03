import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { PricePoint, TradeMarker } from '../types'

interface Props {
  series: PricePoint[]
  trades: TradeMarker[]
}

const W = 760
const H = 280
const PAD_L = 56
const PAD_R = 12
const PAD_T = 16
const PAD_B = 28

function formatDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : d.toLocaleDateString(undefined, { year: '2-digit', month: 'short', day: 'numeric' })
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

const EXPAND_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" />
  </svg>
)
const CLOSE_ICON = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
)

export default function TradeChart({ series, trades }: Props) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [selectedTrade, setSelectedTrade] = useState<TradeMarker | null>(null)

  useEffect(() => {
    if (!fullscreen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFullscreen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreen])

  useEffect(() => {
    if (!selectedTrade) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelectedTrade(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedTrade])

  const times = useMemo(() => series.map(p => new Date(p.t).getTime()), [series])
  const prices = useMemo(() => series.map(p => p.c), [series])

  const { min, max } = useMemo(() => {
    if (prices.length === 0) return { min: 0, max: 1 }
    const lo = Math.min(...prices)
    const hi = Math.max(...prices)
    const pad = (hi - lo) * 0.08 || hi * 0.02 || 1
    return { min: lo - pad, max: hi + pad }
  }, [prices])

  const n = series.length
  const x = (i: number) => (n <= 1 ? PAD_L : PAD_L + (i / (n - 1)) * (W - PAD_L - PAD_R))
  const y = (price: number) => PAD_T + (1 - (price - min) / (max - min || 1)) * (H - PAD_T - PAD_B)

  const linePath = useMemo(() => {
    if (n === 0) return ''
    return series.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(p.c).toFixed(2)}`).join(' ')
  }, [series, min, max]) // eslint-disable-line react-hooks/exhaustive-deps

  const indexForTime = (iso: string): number => {
    const target = new Date(iso).getTime()
    if (times.length === 0) return -1
    let lo = 0
    let hi = times.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (times[mid] < target) lo = mid + 1
      else hi = mid
    }
    if (lo > 0 && Math.abs(times[lo - 1] - target) <= Math.abs(times[lo] - target)) return lo - 1
    return lo
  }

  const yTicks = useMemo(() => {
    const steps = 4
    return Array.from({ length: steps + 1 }, (_, i) => min + ((max - min) * i) / steps)
  }, [min, max])

  const xTickIdx = useMemo(() => {
    if (n === 0) return []
    const steps = Math.min(5, n)
    return Array.from({ length: steps }, (_, i) => Math.round((i / (steps - 1 || 1)) * (n - 1)))
  }, [n])

  const onMove = (e: ReactPointerEvent<SVGRectElement>) => {
    if (n === 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const t = (e.clientX - rect.left) / rect.width
    const idx = Math.round(t * (n - 1))
    setHoverIdx(Math.max(0, Math.min(n - 1, idx)))
  }

  if (n === 0) {
    return <div className="empty">No market data to chart</div>
  }

  const hover = hoverIdx != null ? series[hoverIdx] : null

  const renderChart = (isFullscreen: boolean) => (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} className={`trade-chart-svg${isFullscreen ? ' is-fullscreen' : ''}`} preserveAspectRatio="none">
        {yTicks.map((price, i) => (
          <g key={i}>
            <line x1={PAD_L} x2={W - PAD_R} y1={y(price)} y2={y(price)} className="tc-grid" />
            <text x={PAD_L - 8} y={y(price)} className="tc-axis-label" textAnchor="end" dominantBaseline="middle">
              {price.toFixed(price >= 100 ? 0 : 2)}
            </text>
          </g>
        ))}

        {xTickIdx.map(i => (
          <text key={i} x={x(i)} y={H - 6} className="tc-axis-label" textAnchor="middle">
            {formatDate(series[i].t)}
          </text>
        ))}

        <path d={linePath} className="tc-price-line" fill="none" />

        {trades.map((t, i) => {
          const ei = indexForTime(t.entry_time)
          if (ei < 0) return null
          const ex = x(ei)
          const ey = y(t.entry_price)
          const win = (t.pnl ?? 0) >= 0
          const closed = t.status === 'closed' && t.exit_time && t.exit_price != null
          const xi = closed ? indexForTime(t.exit_time as string) : -1
          const xx = closed && xi >= 0 ? x(xi) : null
          const xy = closed && t.exit_price != null ? y(t.exit_price) : null

          return (
            <g
              key={i}
              className={`tc-trade${win ? ' is-win' : ' is-loss'}`}
              onClick={() => setSelectedTrade(t)}
              tabIndex={0}
              role="button"
              aria-label={`${t.asset} ${t.side} trade details`}
            >
              <circle cx={ex} cy={ey} r={9} className="tc-trade-hit" />
              {xx != null && xy != null && <circle cx={xx} cy={xy} r={9} className="tc-trade-hit" />}
              {xx != null && xy != null && (
                <line x1={ex} y1={ey} x2={xx} y2={xy} className="tc-trade-link" />
              )}
              <path
                d={t.side === 'long' ? `M${ex},${ey - 5} L${ex - 4.5},${ey + 4} L${ex + 4.5},${ey + 4} Z` : `M${ex},${ey + 5} L${ex - 4.5},${ey - 4} L${ex + 4.5},${ey - 4} Z`}
                className="tc-marker tc-marker-entry"
              />
              {xx != null && xy != null && (
                <circle cx={xx} cy={xy} r={3.4} className="tc-marker tc-marker-exit" />
              )}
            </g>
          )
        })}

        {hover && (
          <line x1={x(hoverIdx!)} x2={x(hoverIdx!)} y1={PAD_T} y2={H - PAD_B} className="tc-crosshair" />
        )}

        <rect
          x={PAD_L} y={PAD_T} width={W - PAD_L - PAD_R} height={H - PAD_T - PAD_B}
          fill="transparent"
          onPointerMove={onMove}
          onPointerLeave={() => setHoverIdx(null)}
        />
      </svg>

      {hover && (
        <div className="tc-tooltip" style={{ left: `${(x(hoverIdx!) / W) * 100}%` }}>
          <span className="tc-tooltip-date">{formatDate(hover.t)}</span>
          <span className="tc-tooltip-price">{hover.c.toFixed(2)}</span>
        </div>
      )}

      <div className="tc-legend">
        <span><i className="tc-swatch tc-swatch-entry" /> entry</span>
        <span><i className="tc-swatch tc-swatch-exit" /> exit</span>
        <span><i className="tc-swatch tc-swatch-win" /> win</span>
        <span><i className="tc-swatch tc-swatch-loss" /> loss</span>
      </div>
    </>
  )

  const tradeModal = selectedTrade && createPortal(
    <div className="tc-modal-overlay" onClick={() => setSelectedTrade(null)}>
      <div className="tc-modal" onClick={e => e.stopPropagation()}>
        <button className="tc-close-btn" onClick={() => setSelectedTrade(null)} aria-label="Close trade details">
          {CLOSE_ICON}
        </button>
        <div className="tc-modal-title">
          {selectedTrade.asset} <span className="tc-modal-side">{selectedTrade.side}</span>
        </div>
        <div className="tc-modal-grid">
          <div className="tc-modal-row"><span>Status</span><b>{selectedTrade.status}</b></div>
          <div className="tc-modal-row">
            <span>Entry</span>
            <b>{formatDateTime(selectedTrade.entry_time)} @ {selectedTrade.entry_price.toFixed(2)}</b>
          </div>
          {selectedTrade.exit_time != null && (
            <div className="tc-modal-row">
              <span>Exit</span>
              <b>{formatDateTime(selectedTrade.exit_time)} @ {selectedTrade.exit_price?.toFixed(2)}</b>
            </div>
          )}
          {selectedTrade.pnl != null && (
            <div className="tc-modal-row">
              <span>PnL</span>
              <b className={selectedTrade.pnl >= 0 ? 'pos' : 'neg'}>{selectedTrade.pnl >= 0 ? '+' : ''}{selectedTrade.pnl.toFixed(2)}</b>
            </div>
          )}
          {selectedTrade.return_pct != null && (
            <div className="tc-modal-row">
              <span>Return</span>
              <b className={selectedTrade.return_pct >= 0 ? 'pos' : 'neg'}>{selectedTrade.return_pct >= 0 ? '+' : ''}{selectedTrade.return_pct.toFixed(2)}%</b>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )

  const fullscreenOverlay = fullscreen && createPortal(
    <div className="tc-fullscreen-overlay" onClick={() => setFullscreen(false)}>
      <div className="tc-fullscreen-panel" onClick={e => e.stopPropagation()}>
        <button className="tc-close-btn tc-fullscreen-close" onClick={() => setFullscreen(false)} aria-label="Exit fullscreen">
          {CLOSE_ICON}
        </button>
        <div className="trade-chart is-fullscreen">
          {renderChart(true)}
        </div>
      </div>
    </div>,
    document.body,
  )

  return (
    <div className="trade-chart">
      <button className="tc-expand-btn" onClick={() => setFullscreen(true)} aria-label="Expand chart to fullscreen">
        {EXPAND_ICON}
      </button>
      {renderChart(false)}
      {fullscreenOverlay}
      {tradeModal}
    </div>
  )
}
