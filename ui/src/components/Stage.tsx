import type { ReactNode } from 'react'

export type StageState = 'idle' | 'active' | 'done'

interface StageProps {
  n: number
  title: string
  state: StageState
  badge?: ReactNode
  badgeTone?: 'neutral' | 'pos' | 'neg'
  last?: boolean
  children?: ReactNode
}

const CHECK = (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/**
 * One node on the pipeline spine plus its stage card. The rail node fills with
 * the accent gradient as the stage moves idle → active → done, so the column
 * reads as the paper flowing from research into a backtest.
 */
export default function Stage({ n, title, state, badge, badgeTone = 'neutral', last, children }: StageProps) {
  const badgeClass = badgeTone === 'pos' ? 'card-badge pos' : badgeTone === 'neg' ? 'card-badge neg' : 'card-badge'
  return (
    <div className={`stage-row is-${state}`}>
      <div className="rail">
        <div className="node">{state === 'done' ? CHECK : n}</div>
        {!last && <div className="connector" />}
      </div>
      <div className="card">
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
