import { useCallback, useState } from 'react'
import type { StrategySpec, PortfolioConfig, BacktestResult } from '../types'
import { friendlyError } from '../apiError'
import Stage, { Dots, type StageState } from '../components/Stage'

interface Props {
  state: StageState
  mode: 'spec' | 'code'
  strategySpec: StrategySpec | null
  portfolioConfig: PortfolioConfig | null
  strategyCode: string | null
  alpacaConfigured: boolean
  onDone: (result: BacktestResult) => void
}

function formatReturn(raw: number): string {
  const v = raw * 100
  return v >= 0 ? `+${v.toFixed(2)}%` : `−${(-v).toFixed(2)}%`
}

export default function Step3Backtest({
  state, mode, strategySpec, portfolioConfig, strategyCode, alpacaConfigured, onDone,
}: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<BacktestResult | null>(null)

  const source = mode === 'spec' ? strategySpec : portfolioConfig
  const assets = source?.assets ?? null
  const timeframe = source?.timeframe ?? ''

  const handleRun = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      const body: Record<string, unknown> = { mode }
      if (mode === 'spec') {
        body.strategy_spec = strategySpec
      } else {
        body.strategy_code = strategyCode
        body.portfolio_config = portfolioConfig
      }
      const res = await fetch('/backtest/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw await friendlyError(res)
      const data: BacktestResult = await res.json()
      setResult(data)
      onDone(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [mode, strategySpec, strategyCode, portfolioConfig, onDone])

  let badge: string | undefined
  let badgeTone: 'neutral' | 'pos' | 'neg' = 'neutral'
  if (result) {
    const tr = result.metrics['total_return']
    if (typeof tr === 'number') {
      badge = formatReturn(tr)
      badgeTone = tr >= 0 ? 'pos' : 'neg'
    } else {
      badge = result.backtest_id
    }
  }

  return (
    <Stage n={3} title="Run backtest" state={state} badge={badge} badgeTone={badgeTone}>
      {state === 'active' && !result && (
        <div className="card-body">
          <div className="context">
            <span className="chip">mode <b>{mode}</b></span>
            {assets && assets.length > 0 && <span className="chip">assets <b>{assets.join(', ')}</b></span>}
            {timeframe && <span className="chip">timeframe <b>{timeframe}</b></span>}
          </div>

          {alpacaConfigured ? (
            <button className="btn" onClick={handleRun} disabled={loading}>
              {loading ? <Dots /> : 'Run backtest'}
            </button>
          ) : (
            <div className="banner">
              <span className="mark">!</span>
              <span>
                Market data is unavailable: set <b>DORQ_ALPACA_API_KEY</b> and{' '}
                <b>DORQ_ALPACA_SECRET_KEY</b> in the server environment, then restart.
              </span>
            </div>
          )}
          {error && <p className="error">{error}</p>}
        </div>
      )}

      {result && (
        <div className="card-foot">
          <div className="kv">
            <div className="kv-row"><span className="kv-k">backtest_id</span><span className="kv-v">{result.backtest_id}</span></div>
            {assets && <div className="kv-row"><span className="kv-k">assets</span><span className="kv-v">{assets.join(', ')}</span></div>}
          </div>
        </div>
      )}
    </Stage>
  )
}
