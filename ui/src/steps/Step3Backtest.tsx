import { useCallback, useEffect, useMemo, useState } from 'react'
import type { StrategySpec, PortfolioConfig, BacktestResult, RiskParams } from '../types'
import { friendlyError } from '../apiError'
import Stage, { Working, type StageState } from '../components/Stage'

interface Props {
  state: StageState
  mode: 'spec' | 'code'
  strategySpec: StrategySpec | null
  portfolioConfig: PortfolioConfig | null
  strategyCode: string | null
  alpacaConfigured: boolean
  runCount: number
  onDone: (result: BacktestResult) => void
}

interface EditableParams {
  assetsText: string
  timeframe: string
  startDate: string
  endDate: string
  positionSizing: string
  stopLoss: string
  takeProfit: string
  initCash: string
}

interface SourceLike {
  assets: string[]
  timeframe: string
  date_range: [string, string]
  position_sizing: string
  risk_params: RiskParams
  init_cash: number
}

function toEditable(source: SourceLike): EditableParams {
  return {
    assetsText: source.assets.join(', '),
    timeframe: source.timeframe,
    startDate: source.date_range[0],
    endDate: source.date_range[1],
    positionSizing: source.position_sizing,
    stopLoss: source.risk_params.stop_loss_pct != null ? String(source.risk_params.stop_loss_pct) : '',
    takeProfit: source.risk_params.take_profit_pct != null ? String(source.risk_params.take_profit_pct) : '',
    initCash: String(source.init_cash),
  }
}

function formatReturn(pct: number): string {
  return pct >= 0 ? `+${pct.toFixed(2)}%` : `−${(-pct).toFixed(2)}%`
}

export default function Step3Backtest({
  state, mode, strategySpec, portfolioConfig, strategyCode, alpacaConfigured, runCount, onDone,
}: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<BacktestResult | null>(null)
  const [editing, setEditing] = useState(false)

  const source = mode === 'spec' ? strategySpec : portfolioConfig
  const [params, setParams] = useState<EditableParams | null>(null)

  // Re-derive editable params only when the *portfolio-relevant* fields of the
  // source change — condition edits in step 2 rebuild the spec object on every
  // keystroke and must not wipe the user's customizations here.
  const sourceFingerprint = source
    ? JSON.stringify([source.assets, source.timeframe, source.date_range,
                      source.position_sizing, source.risk_params, source.init_cash])
    : null
  useEffect(() => {
    if (source) setParams(toEditable(source))
  }, [sourceFingerprint]) // eslint-disable-line react-hooks/exhaustive-deps

  const update = useCallback(<K extends keyof EditableParams>(key: K, value: EditableParams[K]) => {
    setParams(p => (p ? { ...p, [key]: value } : p))
  }, [])

  const assetsList = useMemo(
    () => (params?.assetsText ?? '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean),
    [params?.assetsText],
  )
  const datesValid = !!params && params.startDate !== '' && params.endDate !== '' && params.startDate < params.endDate
  const canRun = !!params && assetsList.length > 0 && datesValid

  const handleRun = useCallback(async () => {
    if (!source || !params || !canRun) return
    setError(null)
    setLoading(true)
    try {
      const overrides = {
        assets: assetsList,
        timeframe: params.timeframe,
        date_range: [params.startDate, params.endDate] as [string, string],
        position_sizing: params.positionSizing,
        risk_params: {
          stop_loss_pct: params.stopLoss.trim() === '' ? null : Number(params.stopLoss),
          take_profit_pct: params.takeProfit.trim() === '' ? null : Number(params.takeProfit),
        },
        init_cash: Number(params.initCash) > 0 ? Number(params.initCash) : 100_000,
      }

      const body: Record<string, unknown> = { mode }
      if (mode === 'spec') {
        body.strategy_spec = { ...strategySpec, ...overrides }
      } else {
        body.strategy_code = strategyCode
        body.portfolio_config = { ...portfolioConfig, ...overrides }
      }
      const res = await fetch('/backtest/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw await friendlyError(res)
      const data: BacktestResult = await res.json()
      setResult(data)
      setEditing(false)
      onDone(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [mode, strategySpec, strategyCode, portfolioConfig, source, params, canRun, assetsList, onDone])

  let badge: string | undefined
  let badgeTone: 'neutral' | 'pos' | 'neg' = 'neutral'
  if (result) {
    const tr = result.metrics['total_return']
    if (typeof tr === 'number') {
      badge = runCount > 1 ? `run ${runCount} · ${formatReturn(tr)}` : formatReturn(tr)
      badgeTone = tr >= 0 ? 'pos' : 'neg'
    } else {
      badge = result.backtest_id
    }
  }

  const showForm = params && ((state === 'active' && !result) || editing)

  return (
    <Stage n={3} title="Run backtest" state={state} badge={badge} badgeTone={badgeTone}>
      {showForm && (
        <div className="card-body">
          <div className="context">
            <span className="chip">mode <b>{mode}</b></span>
            {runCount > 0 && <span className="chip">runs so far <b>{runCount}</b></span>}
          </div>

          <div className="param-grid">
            <label className="field">
              <span className="field-label">Assets</span>
              <input
                className="input"
                value={params.assetsText}
                onChange={e => update('assetsText', e.target.value)}
                placeholder="SPY, TLT"
              />
            </label>
            <label className="field">
              <span className="field-label">Timeframe</span>
              <select className="input" value={params.timeframe} onChange={e => update('timeframe', e.target.value)}>
                <option value="1D">1D</option>
                <option value="1W">1W</option>
                <option value="1M">1M</option>
              </select>
            </label>
            <label className="field">
              <span className="field-label">Start date</span>
              <input className="input" type="date" value={params.startDate} onChange={e => update('startDate', e.target.value)} />
            </label>
            <label className="field">
              <span className="field-label">End date</span>
              <input className="input" type="date" value={params.endDate} onChange={e => update('endDate', e.target.value)} />
            </label>
            <label className="field">
              <span className="field-label">Position sizing</span>
              <select className="input" value={params.positionSizing} onChange={e => update('positionSizing', e.target.value)}>
                <option value="equal_weight">equal_weight</option>
                <option value="fixed">fixed</option>
                <option value="percent_equity">percent_equity</option>
              </select>
            </label>
            <label className="field">
              <span className="field-label">Initial cash</span>
              <input className="input" type="number" min={1} value={params.initCash} onChange={e => update('initCash', e.target.value)} />
            </label>
            <label className="field">
              <span className="field-label">Stop loss %</span>
              <input className="input" type="number" step="0.1" placeholder="none" value={params.stopLoss} onChange={e => update('stopLoss', e.target.value)} />
            </label>
            <label className="field">
              <span className="field-label">Take profit %</span>
              <input className="input" type="number" step="0.1" placeholder="none" value={params.takeProfit} onChange={e => update('takeProfit', e.target.value)} />
            </label>
          </div>

          {alpacaConfigured ? (
            <button className="btn" onClick={handleRun} disabled={loading || !canRun}>
              {loading ? <Working label="fetching data & simulating" /> : result ? 'Re-run backtest' : 'Run backtest'}
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
          {!canRun && <p className="note">Enter at least one asset and a valid date range to run.</p>}
          {error && <p className="error">{error}</p>}
        </div>
      )}

      {result && !editing && (
        <div className="card-foot">
          <div className="kv">
            <div className="kv-row"><span className="kv-k">backtest_id</span><span className="kv-v">{result.backtest_id}</span></div>
            {params && <div className="kv-row"><span className="kv-k">assets</span><span className="kv-v">{params.assetsText}</span></div>}
            {params && <div className="kv-row"><span className="kv-k">range</span><span className="kv-v">{params.startDate} → {params.endDate}</span></div>}
          </div>
          <button className="btn btn-ghost" onClick={() => setEditing(true)}>
            Adjust parameters &amp; re-run
          </button>
        </div>
      )}
    </Stage>
  )
}
