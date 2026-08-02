import { useMemo, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { CurvePoint } from '../types'
import { useZoomPan, ZoomControls } from '../lib/useZoomPan'

interface Props {
  drawdown: CurvePoint[]
}

const W = 760
const H = 260
const PAD_L = 62
const PAD_R = 12
const PAD_T = 14
const PAD_B = 24

function formatDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? iso.slice(0, 10)
    : d.toLocaleDateString(undefined, { year: '2-digit', month: 'short', day: 'numeric' })
}

/**
 * Standalone drawdown panel for the chart workspace: the underwater curve
 * (percent points ≤ 0) as a filled area, full-size with axes, hover, and
 * wheel/drag zoom — the equity card only carries a small strip of this.
 */
export default function DrawdownChart({ drawdown }: Props) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  const zoom = useZoomPan(drawdown.length)
  const view = useMemo(() => drawdown.slice(zoom.a, zoom.b + 1), [drawdown, zoom.a, zoom.b])
  const n = view.length

  const min = useMemo(() => {
    const values = view.map(p => p.v)
    return values.length ? Math.min(Math.min(...values), -0.01) : -1
  }, [view])

  const x = (i: number) => (n <= 1 ? PAD_L : PAD_L + (i / (n - 1)) * (W - PAD_L - PAD_R))
  const y = (v: number) => PAD_T + (v / min) * (H - PAD_T - PAD_B)

  const area = useMemo(() => {
    if (n === 0) return ''
    const line = view.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(p.v).toFixed(2)}`).join(' ')
    return `${line} L${x(n - 1).toFixed(2)},${y(0).toFixed(2)} L${x(0).toFixed(2)},${y(0).toFixed(2)} Z`
  }, [view, min]) // eslint-disable-line react-hooks/exhaustive-deps

  const yTicks = useMemo(() => {
    const steps = 4
    return Array.from({ length: steps + 1 }, (_, i) => (min * i) / steps)
  }, [min])

  const xTickIdx = useMemo(() => {
    if (n === 0) return []
    const steps = Math.min(5, n)
    return Array.from({ length: steps }, (_, i) => Math.round((i / (steps - 1 || 1)) * (n - 1)))
  }, [n])

  const onMove = (e: ReactPointerEvent<SVGRectElement>) => {
    if (zoom.onPointerMove(e)) { setHoverIdx(null); return }
    if (n === 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const t = (e.clientX - rect.left) / rect.width
    setHoverIdx(Math.max(0, Math.min(n - 1, Math.round(t * (n - 1)))))
  }

  if (drawdown.length === 0) return <div className="empty">No drawdown data</div>

  const hover = hoverIdx != null && hoverIdx < n ? view[hoverIdx] : null

  return (
    <div className={`dd-chart${zoom.zoomed ? ' is-zoomed' : ''}`} ref={zoom.containerRef}>
      <ZoomControls zoom={zoom} />
      <svg viewBox={`0 0 ${W} ${H}`} className="dd-chart-svg" preserveAspectRatio="none" aria-label="Drawdown">
        {yTicks.map((v, i) => (
          <g key={i}>
            <line x1={PAD_L} x2={W - PAD_R} y1={y(v)} y2={y(v)} className="tc-grid" />
            <text x={PAD_L - 8} y={y(v)} className="tc-axis-label" textAnchor="end" dominantBaseline="middle">
              {v.toFixed(0)}%
            </text>
          </g>
        ))}
        {xTickIdx.map(i => (
          <text key={i} x={x(i)} y={H - 6} className="tc-axis-label" textAnchor="middle">
            {formatDate(view[i].t)}
          </text>
        ))}

        <path d={area} className="ec-dd-area" />

        {hover && (
          <line x1={x(hoverIdx!)} x2={x(hoverIdx!)} y1={PAD_T} y2={H - PAD_B} className="tc-crosshair" />
        )}
        <rect
          x={PAD_L} y={PAD_T} width={W - PAD_L - PAD_R} height={H - PAD_T - PAD_B}
          fill="transparent"
          onPointerDown={zoom.onPointerDown}
          onPointerUp={zoom.onPointerUp}
          onPointerMove={onMove}
          onPointerLeave={() => { zoom.onPointerUp(); setHoverIdx(null) }}
          onDoubleClick={zoom.reset}
        />
      </svg>

      {hover && (
        <div className="tc-tooltip" style={{ left: `${(x(hoverIdx!) / W) * 100}%` }}>
          <span className="tc-tooltip-date">{formatDate(hover.t)}</span>
          <span className="tc-tooltip-price">{hover.v.toFixed(2)}%</span>
        </div>
      )}

      <div className="tc-legend">
        <span><i className="tc-swatch ec-swatch-dd" /> drawdown from peak</span>
        <span className="tc-zoom-hint">scroll to zoom · drag to pan</span>
      </div>
    </div>
  )
}
