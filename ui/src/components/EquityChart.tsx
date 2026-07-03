import { useMemo, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { CurvePoint } from '../types'

interface Props {
  equity: CurvePoint[]
  benchmark: CurvePoint[]
  drawdown: CurvePoint[]
}

const W = 760
const H = 260
const DD_H = 84
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

function formatMoney(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`
  if (Math.abs(v) >= 10_000) return `${(v / 1000).toFixed(1)}k`
  return v.toFixed(0)
}

/** Map a sparse curve onto the x-index of the primary (equity) curve by
 *  timestamp, carrying the last value forward for gaps. */
function alignTo(times: number[], curve: CurvePoint[]): (number | null)[] {
  const out: (number | null)[] = new Array(times.length).fill(null)
  let j = 0
  let last: number | null = null
  for (let i = 0; i < times.length; i++) {
    while (j < curve.length && new Date(curve[j].t).getTime() <= times[i]) {
      last = curve[j].v
      j++
    }
    out[i] = last
  }
  return out
}

/**
 * Portfolio equity vs. equal-weight buy-and-hold, with a drawdown strip
 * underneath. Pure SVG, same visual language as TradeChart.
 */
export default function EquityChart({ equity, benchmark, drawdown }: Props) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  const times = useMemo(() => equity.map(p => new Date(p.t).getTime()), [equity])
  const benchAligned = useMemo(() => alignTo(times, benchmark), [times, benchmark])
  const ddAligned = useMemo(() => alignTo(times, drawdown), [times, drawdown])

  const n = equity.length

  const { min, max } = useMemo(() => {
    const values = equity.map(p => p.v).concat(benchAligned.filter((v): v is number => v != null))
    if (values.length === 0) return { min: 0, max: 1 }
    const lo = Math.min(...values)
    const hi = Math.max(...values)
    const pad = (hi - lo) * 0.06 || hi * 0.02 || 1
    return { min: lo - pad, max: hi + pad }
  }, [equity, benchAligned])

  const ddMin = useMemo(() => {
    const values = ddAligned.filter((v): v is number => v != null)
    return values.length ? Math.min(Math.min(...values), -0.01) : -1
  }, [ddAligned])

  const x = (i: number) => (n <= 1 ? PAD_L : PAD_L + (i / (n - 1)) * (W - PAD_L - PAD_R))
  const y = (v: number) => PAD_T + (1 - (v - min) / (max - min || 1)) * (H - PAD_T - PAD_B)
  const ddY = (v: number) => 4 + (v / ddMin) * (DD_H - 22)

  const buildPath = (values: (number | null)[], yFn: (v: number) => number) => {
    let d = ''
    let pen = false
    for (let i = 0; i < values.length; i++) {
      const v = values[i]
      if (v == null) { pen = false; continue }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(2)},${yFn(v).toFixed(2)} `
      pen = true
    }
    return d.trim()
  }

  const equityPath = useMemo(
    () => buildPath(equity.map(p => p.v), y),
    [equity, min, max], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const benchPath = useMemo(
    () => buildPath(benchAligned, y),
    [benchAligned, min, max], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const ddArea = useMemo(() => {
    const line = buildPath(ddAligned, ddY)
    if (!line) return ''
    // Close the path along the top (drawdown 0 line) to fill the area.
    return `${line} L${x(n - 1).toFixed(2)},${ddY(0).toFixed(2)} L${x(0).toFixed(2)},${ddY(0).toFixed(2)} Z`
  }, [ddAligned, ddMin, n]) // eslint-disable-line react-hooks/exhaustive-deps

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
    setHoverIdx(Math.max(0, Math.min(n - 1, Math.round(t * (n - 1)))))
  }

  if (n === 0) return <div className="empty">No equity data</div>

  const hover = hoverIdx != null ? equity[hoverIdx] : null
  const hoverBench = hoverIdx != null ? benchAligned[hoverIdx] : null
  const hoverDd = hoverIdx != null ? ddAligned[hoverIdx] : null

  return (
    <div className="equity-chart">
      <svg viewBox={`0 0 ${W} ${H}`} className="equity-chart-svg" preserveAspectRatio="none">
        {yTicks.map((v, i) => (
          <g key={i}>
            <line x1={PAD_L} x2={W - PAD_R} y1={y(v)} y2={y(v)} className="tc-grid" />
            <text x={PAD_L - 8} y={y(v)} className="tc-axis-label" textAnchor="end" dominantBaseline="middle">
              {formatMoney(v)}
            </text>
          </g>
        ))}
        {xTickIdx.map(i => (
          <text key={i} x={x(i)} y={H - 6} className="tc-axis-label" textAnchor="middle">
            {formatDate(equity[i].t)}
          </text>
        ))}

        <path d={benchPath} className="ec-bench-line" fill="none" />
        <path d={equityPath} className="ec-equity-line" fill="none" />

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

      <svg viewBox={`0 0 ${W} ${DD_H}`} className="equity-dd-svg" preserveAspectRatio="none" aria-label="Drawdown">
        <line x1={PAD_L} x2={W - PAD_R} y1={ddY(0)} y2={ddY(0)} className="tc-grid" />
        <text x={PAD_L - 8} y={ddY(0)} className="tc-axis-label" textAnchor="end" dominantBaseline="middle">0</text>
        <text x={PAD_L - 8} y={ddY(ddMin)} className="tc-axis-label" textAnchor="end" dominantBaseline="middle">
          {ddMin.toFixed(0)}%
        </text>
        <path d={ddArea} className="ec-dd-area" />
        {hover && (
          <line x1={x(hoverIdx!)} x2={x(hoverIdx!)} y1={0} y2={DD_H} className="tc-crosshair" />
        )}
      </svg>

      {hover && (
        <div className="tc-tooltip" style={{ left: `${(x(hoverIdx!) / W) * 100}%` }}>
          <span className="tc-tooltip-date">{formatDate(hover.t)}</span>
          <span className="tc-tooltip-price">{formatMoney(hover.v)}</span>
          {hoverBench != null && <span className="ec-tooltip-bench">bh {formatMoney(hoverBench)}</span>}
          {hoverDd != null && <span className="ec-tooltip-dd">{hoverDd.toFixed(1)}%</span>}
        </div>
      )}

      <div className="tc-legend">
        <span><i className="tc-swatch ec-swatch-equity" /> strategy equity</span>
        <span><i className="tc-swatch ec-swatch-bench" /> buy &amp; hold</span>
        <span><i className="tc-swatch ec-swatch-dd" /> drawdown</span>
      </div>
    </div>
  )
}
