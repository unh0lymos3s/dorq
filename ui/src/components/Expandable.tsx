import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

export const EXPAND_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" />
  </svg>
)
const CLOSE_ICON = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
)

/** Fullscreen chart overlay — shared by Expandable and ArtifactCard. */
export function ChartOverlay({ title, onClose, children }: { title?: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="tc-fullscreen-overlay" onClick={onClose}>
      <div className="tc-fullscreen-panel" onClick={e => e.stopPropagation()}>
        <button className="tc-close-btn tc-fullscreen-close" onClick={onClose} aria-label="Exit fullscreen">
          {CLOSE_ICON}
        </button>
        {title && <div className="xp-title">{title}</div>}
        <div className="xp-body">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

/**
 * Wraps a chart with an expand-to-fullscreen button. When open, the children
 * are rendered a second time inside a portal overlay (a fresh chart instance
 * with its own zoom/hover state — the props are the same data).
 */
export default function Expandable({ title, children }: { title?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="xp">
      <button className="tc-expand-btn" onClick={() => setOpen(true)} aria-label="Expand chart to fullscreen" title="Fullscreen">
        {EXPAND_ICON}
      </button>
      {children}
      {open && <ChartOverlay title={title} onClose={() => setOpen(false)}>{children}</ChartOverlay>}
    </div>
  )
}
