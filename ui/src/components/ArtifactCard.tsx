import { useCallback, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { downloadCsv, downloadSvgsAsPng } from '../lib/download'
import { ChartOverlay, EXPAND_ICON } from './Expandable'

interface Props {
  title: string
  /** Base filename (no extension) for downloads. */
  slug: string
  /** Rows (header first) for the CSV download; omit to hide the button. */
  csvRows?: () => (string | number | null)[][]
  children: ReactNode
}

const DOWNLOAD_ICON = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3v12M6 11l6 6 6-6M4 21h16" />
  </svg>
)

/**
 * A chart panel in the workspace: glass card with a title bar and
 * fullscreen / PNG / CSV actions. PNG export rasterizes every chart SVG inside
 * the card body (stacked) at 2× on the current theme background. Fullscreen
 * re-renders the children in a portal overlay.
 */
export default function ArtifactCard({ title, slug, csvRows, children }: Props) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  const [full, setFull] = useState(false)

  const onPng = useCallback(async () => {
    const body = bodyRef.current
    if (!body || busy) return
    const svgs = Array.from(
      body.querySelectorAll<SVGSVGElement>(
        'svg.trade-chart-svg, svg.equity-chart-svg, svg.equity-dd-svg, svg.dd-chart-svg',
      ),
    )
    if (svgs.length === 0) return
    setBusy(true)
    try {
      await downloadSvgsAsPng(svgs, `${slug}.png`)
    } catch (err) {
      console.error('PNG export failed', err)
    } finally {
      setBusy(false)
    }
  }, [slug, busy])

  const onCsv = useCallback(() => {
    if (csvRows) downloadCsv(csvRows(), `${slug}.csv`)
  }, [csvRows, slug])

  return (
    <section className="artifact-card">
      <header className="artifact-head">
        <span className="artifact-title">{title}</span>
        <span className="artifact-actions">
          <button className="artifact-btn" onClick={() => setFull(true)} title="View fullscreen">
            {EXPAND_ICON} full
          </button>
          <button className="artifact-btn" onClick={onPng} disabled={busy} title="Download chart as PNG">
            {DOWNLOAD_ICON} png
          </button>
          {csvRows && (
            <button className="artifact-btn" onClick={onCsv} title="Download data as CSV">
              {DOWNLOAD_ICON} csv
            </button>
          )}
        </span>
      </header>
      <div className="artifact-body" ref={bodyRef}>
        {children}
      </div>
      {full && <ChartOverlay title={title} onClose={() => setFull(false)}>{children}</ChartOverlay>}
    </section>
  )
}
