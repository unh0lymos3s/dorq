import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

/** Fewest data points a zoom window may hold. */
const MIN_SPAN = 8

export interface ZoomPan {
  /** First and last visible data index (inclusive). */
  a: number
  b: number
  zoomed: boolean
  /** Attach to the chart wrapper — hosts the non-passive wheel listener. */
  containerRef: React.RefObject<HTMLDivElement>
  zoomIn: () => void
  zoomOut: () => void
  reset: () => void
  /** Spread onto the pointer-capture rect; drag pans when zoomed.
   *  onPointerMove returns true while a pan drag is in progress. */
  onPointerDown: (e: ReactPointerEvent<Element>) => void
  onPointerMove: (e: ReactPointerEvent<Element>) => boolean
  onPointerUp: () => void
}

/**
 * Index-window zoom + pan over a series of `n` points. Wheel zooms around the
 * cursor (native non-passive listener — React's synthetic onWheel can't
 * preventDefault page scroll), dragging pans when zoomed, double-click resets.
 * Charts slice their data to [a, b] and render as usual.
 */
export function useZoomPan(n: number): ZoomPan {
  const [win, setWin] = useState<{ a: number; b: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ startX: number; a: number; b: number; moved: boolean } | null>(null)

  // New data → back to the full range.
  useEffect(() => { setWin(null) }, [n])

  const a = win ? Math.max(0, Math.min(win.a, n - 1)) : 0
  const b = win ? Math.max(a, Math.min(win.b, n - 1)) : Math.max(0, n - 1)

  /** Rescale the window by `factor` keeping the point at `frac` fixed. */
  const applyZoom = useCallback((frac: number, factor: number) => {
    setWin(prev => {
      const pa = prev?.a ?? 0
      const pb = prev?.b ?? n - 1
      const span = pb - pa
      let newSpan = Math.round(span * factor)
      if (factor < 1 && newSpan < MIN_SPAN) newSpan = MIN_SPAN
      if (newSpan >= n - 1) return null
      const center = pa + frac * span
      let na = Math.round(center - frac * newSpan)
      let nb = na + newSpan
      if (na < 0) { nb -= na; na = 0 }
      if (nb > n - 1) { na -= nb - (n - 1); nb = n - 1 }
      na = Math.max(0, na)
      if (na === 0 && nb >= n - 1) return null
      return { a: na, b: nb }
    })
  }, [n])

  useEffect(() => {
    const el = containerRef.current
    if (!el || n <= MIN_SPAN) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
      applyZoom(frac, e.deltaY < 0 ? 0.7 : 1 / 0.7)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [applyZoom, n])

  const onPointerDown = useCallback((e: ReactPointerEvent<Element>) => {
    if (!win) return
    drag.current = { startX: e.clientX, a, b, moved: false }
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
  }, [win, a, b])

  const onPointerMove = useCallback((e: ReactPointerEvent<Element>): boolean => {
    const d = drag.current
    const el = containerRef.current
    if (!d || !el) return false
    const rect = el.getBoundingClientRect()
    const span = d.b - d.a
    const shift = Math.round(((d.startX - e.clientX) / rect.width) * span)
    if (shift !== 0) d.moved = true
    let na = d.a + shift
    let nb = d.b + shift
    if (na < 0) { nb -= na; na = 0 }
    if (nb > n - 1) { na -= nb - (n - 1); nb = n - 1 }
    setWin({ a: Math.max(0, na), b: nb })
    return d.moved
  }, [n])

  const onPointerUp = useCallback(() => { drag.current = null }, [])

  const zoomIn = useCallback(() => applyZoom(0.5, 0.6), [applyZoom])
  const zoomOut = useCallback(() => applyZoom(0.5, 1 / 0.6), [applyZoom])
  const reset = useCallback(() => setWin(null), [])

  return { a, b, zoomed: win !== null, containerRef, zoomIn, zoomOut, reset, onPointerDown, onPointerMove, onPointerUp }
}

/** Small −/+/reset cluster overlaid on a chart's top-left corner. */
export function ZoomControls({ zoom }: { zoom: ZoomPan }) {
  return (
    <div className="zoom-ctrl" aria-label="Zoom controls">
      <button onClick={zoom.zoomOut} disabled={!zoom.zoomed} aria-label="Zoom out">−</button>
      <button onClick={zoom.zoomIn} aria-label="Zoom in">+</button>
      {zoom.zoomed && <button onClick={zoom.reset} aria-label="Reset zoom">⟲</button>}
    </div>
  )
}
