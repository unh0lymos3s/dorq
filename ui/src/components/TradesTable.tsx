import { useMemo, useState } from 'react'
import type { TradeMarker } from '../types'

interface Props {
  trades: TradeMarker[]
}

type SortKey = 'entry_time' | 'pnl' | 'return_pct'

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? iso.slice(0, 10)
    : d.toLocaleDateString(undefined, { year: '2-digit', month: 'short', day: 'numeric' })
}

function fmtNum(v: number | null, suffix = ''): string {
  if (v == null) return '—'
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}${suffix}`
}

/** Every simulated trade, sortable by date or outcome. */
export default function TradesTable({ trades }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('entry_time')
  const [desc, setDesc] = useState(false)

  const sorted = useMemo(() => {
    const copy = [...trades]
    copy.sort((a, b) => {
      let cmp: number
      if (sortKey === 'entry_time') cmp = a.entry_time.localeCompare(b.entry_time)
      else cmp = (a[sortKey] ?? -Infinity) - (b[sortKey] ?? -Infinity)
      return desc ? -cmp : cmp
    })
    return copy
  }, [trades, sortKey, desc])

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setDesc(d => !d)
    else { setSortKey(key); setDesc(key !== 'entry_time') }
  }

  if (trades.length === 0) return null

  const arrow = (key: SortKey) => (sortKey === key ? (desc ? ' ↓' : ' ↑') : '')

  return (
    <div className="trades-table-wrap">
      <table className="trades-table">
        <thead>
          <tr>
            <th>Asset</th>
            <th>Side</th>
            <th className="is-sortable" onClick={() => toggleSort('entry_time')}>Entry{arrow('entry_time')}</th>
            <th>Exit</th>
            <th className="num">In</th>
            <th className="num">Out</th>
            <th className="num is-sortable" onClick={() => toggleSort('pnl')}>PnL{arrow('pnl')}</th>
            <th className="num is-sortable" onClick={() => toggleSort('return_pct')}>Return{arrow('return_pct')}</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((t, i) => (
            <tr key={i}>
              <td>{t.asset}</td>
              <td className="dim">{t.side}{t.status === 'open' ? ' · open' : ''}</td>
              <td className="dim">{fmtDate(t.entry_time)}</td>
              <td className="dim">{fmtDate(t.exit_time)}</td>
              <td className="num">{t.entry_price.toFixed(2)}</td>
              <td className="num">{t.exit_price != null ? t.exit_price.toFixed(2) : '—'}</td>
              <td className={`num ${t.pnl != null && t.pnl < 0 ? 'neg' : 'pos'}`}>{fmtNum(t.pnl)}</td>
              <td className={`num ${t.return_pct != null && t.return_pct < 0 ? 'neg' : 'pos'}`}>{fmtNum(t.return_pct, '%')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
