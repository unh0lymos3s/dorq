import { useEffect, useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'

export type StageState = 'idle' | 'active' | 'done'

interface StageProps {
  title: string
  state: StageState
  badge?: ReactNode
  badgeTone?: 'neutral' | 'pos' | 'neg'
  children?: ReactNode
}

/**
 * One stage card in the pipeline column. The idle → active → done state rides
 * on the row class, which dims or lifts the card as the paper moves through.
 */
export default function Stage({ title, state, badge, badgeTone = 'neutral', children }: StageProps) {
  const badgeClass = badgeTone === 'pos' ? 'card-badge pos' : badgeTone === 'neg' ? 'card-badge neg' : 'card-badge'
  const onMove = (e: MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`)
    e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`)
  }
  return (
    <div className={`stage-row is-${state}`}>
      <div className="card" onMouseMove={onMove}>
        <div className="card-head">
          <h2 className="card-title">{title}</h2>
          {badge != null && <span className={badgeClass}>{badge}</span>}
        </div>
        {children}
      </div>
    </div>
  )
}

export const Dots = () => (
  <span className="dots" aria-label="Loading">
    <i /><i /><i />
  </span>
)

/**
 * Loading dots plus a running elapsed-seconds counter — local model calls can
 * take minutes, so the user needs to see that time is passing, not a stall.
 */
export function Working({ label }: { label?: string }) {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    const started = Date.now()
    const id = window.setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => window.clearInterval(id)
  }, [])
  const mm = Math.floor(seconds / 60)
  const ss = seconds % 60
  return (
    <span className="working">
      <Dots />
      <span className="working-time">
        {label ? `${label} · ` : ''}{mm > 0 ? `${mm}m ${ss}s` : `${ss}s`}
      </span>
    </span>
  )
}
