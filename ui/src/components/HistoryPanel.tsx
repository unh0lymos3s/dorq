import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { MemoryPaper, MemoryStrategy } from '../types'

interface Props {
  open: boolean
  onClose: () => void
  /** Restore handlers throw with a user-readable message on failure. */
  onRestorePaper: (paperId: string) => Promise<void>
  onRestoreStrategy: (strategyId: string) => Promise<void>
}

function formatWhen(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function paperLabel(p: MemoryPaper): string {
  return p.filename || p.source_url || p.paper_id
}

/**
 * Slide-over drawer listing every paper and strategy the memory engine has
 * persisted (they survive restarts). Selecting one restores it into the
 * pipeline so the user can pick up where an earlier session left off.
 */
export default function HistoryPanel({ open, onClose, onRestorePaper, onRestoreStrategy }: Props) {
  const [tab, setTab] = useState<'papers' | 'strategies'>('papers')
  const [papers, setPapers] = useState<MemoryPaper[]>([])
  const [strategies, setStrategies] = useState<MemoryStrategy[]>([])
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    if (!open) return
    let alive = true
    setLoading(true)
    setError(null)
    Promise.all([
      fetch('/memory/papers').then(r => (r.ok ? r.json() : Promise.reject(new Error('history unavailable')))),
      fetch('/memory/strategies').then(r => (r.ok ? r.json() : Promise.reject(new Error('history unavailable')))),
    ])
      .then(([p, s]) => { if (alive) { setPapers(p); setStrategies(s) } })
      .catch(() => { if (alive) setError('Could not load history from the server.') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const q = filter.trim().toLowerCase()
  const shownPapers = useMemo(
    () => (q ? papers.filter(p => paperLabel(p).toLowerCase().includes(q)) : papers),
    [papers, q],
  )
  const shownStrategies = useMemo(
    () => (q
      ? strategies.filter(s =>
          [s.title, s.kind, ...(s.assets ?? [])].filter(Boolean).join(' ').toLowerCase().includes(q))
      : strategies),
    [strategies, q],
  )

  const restore = async (kind: 'paper' | 'strategy', id: string) => {
    setBusyId(id)
    setError(null)
    try {
      if (kind === 'paper') await onRestorePaper(id)
      else await onRestoreStrategy(id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Restore failed.')
    } finally {
      setBusyId(null)
    }
  }

  if (!open) return null

  return createPortal(
    <div className="history-overlay" onClick={onClose}>
      <aside className="history-drawer" onClick={e => e.stopPropagation()} aria-label="Session history">
        <header className="history-head">
          <span className="history-title">History</span>
          <button className="tc-close-btn" onClick={onClose} aria-label="Close history">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="tabs history-tabs" role="tablist">
          <button className={`tab${tab === 'papers' ? ' is-on' : ''}`} onClick={() => setTab('papers')}>
            Papers · {papers.length}
          </button>
          <button className={`tab${tab === 'strategies' ? ' is-on' : ''}`} onClick={() => setTab('strategies')}>
            Strategies · {strategies.length}
          </button>
        </div>

        <input
          className="input history-filter"
          placeholder="Filter…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />

        {error && <p className="error">{error}</p>}

        <div className="history-list">
          {loading && <div className="empty">Loading…</div>}

          {!loading && tab === 'papers' && (
            shownPapers.length === 0
              ? <div className="empty">{q ? 'No papers match.' : 'No papers stored yet.'}</div>
              : shownPapers.map(p => (
                  <button
                    key={p.paper_id}
                    className="history-row"
                    disabled={busyId !== null}
                    onClick={() => restore('paper', p.paper_id)}
                  >
                    <span className="hr-title">{paperLabel(p)}</span>
                    <span className="hr-meta">
                      {formatWhen(p.saved_at)}
                      {p.markdown_length > 0 && ` · ${(p.markdown_length / 1000).toFixed(0)}k chars`}
                      {busyId === p.paper_id && ' · loading…'}
                    </span>
                  </button>
                ))
          )}

          {!loading && tab === 'strategies' && (
            shownStrategies.length === 0
              ? <div className="empty">{q ? 'No strategies match.' : 'No strategies stored yet.'}</div>
              : shownStrategies.map(s => (
                  <button
                    key={s.strategy_id}
                    className="history-row"
                    disabled={busyId !== null}
                    onClick={() => restore('strategy', s.strategy_id)}
                  >
                    <span className="hr-title">{s.title || (s.kind === 'code' ? 'Code strategy' : 'Strategy')}</span>
                    <span className="hr-meta">
                      <span className="hr-kind">{s.kind}</span>
                      {s.assets?.length ? ` · ${s.assets.slice(0, 4).join(' ')}` : ''}
                      {s.timeframe ? ` · ${s.timeframe}` : ''}
                      {s.saved_at ? ` · ${formatWhen(s.saved_at)}` : ''}
                      {busyId === s.strategy_id && ' · loading…'}
                    </span>
                  </button>
                ))
          )}
        </div>
      </aside>
    </div>,
    document.body,
  )
}
