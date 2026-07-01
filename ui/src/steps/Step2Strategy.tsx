import { useCallback, useState } from 'react'
import type { StrategySpec, PortfolioConfig, CodeStrategyResult } from '../types'
import { friendlyError } from '../apiError'
import Stage, { Dots, type StageState } from '../components/Stage'

interface Props {
  state: StageState
  paperId: string | null
  model?: string
  onDone: (
    mode: 'spec' | 'code',
    spec: StrategySpec | null,
    config: PortfolioConfig | null,
    code: string | null,
  ) => void
}

export default function Step2Strategy({ state, paperId, model, onDone }: Props) {
  const [tab, setTab] = useState<'spec' | 'code'>('spec')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [specResult, setSpecResult] = useState<StrategySpec | null>(null)
  const [codeResult, setCodeResult] = useState<CodeStrategyResult | null>(null)

  const handleGenerate = useCallback(async () => {
    if (!paperId) { setError('No paper loaded.'); return }
    setError(null)
    setLoading(true)
    try {
      const endpoint = tab === 'spec' ? '/strategies/generate' : '/strategies/generate-code'
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paper_id: paperId }),
      })
      if (!res.ok) throw await friendlyError(res)
      if (tab === 'spec') {
        const data: StrategySpec = await res.json()
        setSpecResult(data); setCodeResult(null)
        onDone('spec', data, null, null)
      } else {
        const data: CodeStrategyResult = await res.json()
        setCodeResult(data); setSpecResult(null)
        onDone('code', null, data.portfolio_config, data.strategy_code)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [paperId, tab, onDone])

  const hasResult = specResult !== null || codeResult !== null
  const badge = specResult
    ? (specResult.title || 'spec')
    : codeResult
    ? `code · ${codeResult.strategy_code.length} chars`
    : undefined

  return (
    <Stage n={2} title="Generate strategy" state={state} badge={badge}>
      {state === 'active' && !hasResult && (
        <div className="card-body">
          <div className="tabs" role="tablist">
            <button className={`tab${tab === 'spec' ? ' is-on' : ''}`} onClick={() => setTab('spec')}>Strategy spec</button>
            <button className={`tab${tab === 'code' ? ' is-on' : ''}`} onClick={() => setTab('code')}>Code strategy</button>
          </div>

          <p className="summary-text">
            {tab === 'spec'
              ? 'Distil the paper into a structured, rule-based strategy spec.'
              : 'Generate vectorbt strategy code derived from the paper.'}
          </p>

          <button className="btn" onClick={handleGenerate} disabled={loading}>
            {loading ? <Dots /> : 'Generate'}
          </button>

          <p className="note">
            Runs locally on <code>{model ?? 'ollama'}</code> — no keys, nothing leaves your machine.
          </p>
          {error && <p className="error">{error}</p>}
        </div>
      )}

      {specResult && (
        <div className="card-foot">
          <div className="summary-title">{specResult.title}</div>
          <div className="summary-text">{specResult.summary}</div>
          <div className="kv">
            <div className="kv-row"><span className="kv-k">assets</span><span className="kv-v">{specResult.assets.join(', ')}</span></div>
            <div className="kv-row"><span className="kv-k">timeframe</span><span className="kv-v">{specResult.timeframe}</span></div>
            <div className="kv-row"><span className="kv-k">range</span><span className="kv-v">{specResult.date_range[0]} → {specResult.date_range[1]}</span></div>
          </div>
        </div>
      )}

      {codeResult && (
        <div className="card-foot">
          <div className="summary-title">Code strategy</div>
          <div className="kv">
            <div className="kv-row"><span className="kv-k">assets</span><span className="kv-v">{codeResult.portfolio_config.assets.join(', ')}</span></div>
            <div className="kv-row"><span className="kv-k">timeframe</span><span className="kv-v">{codeResult.portfolio_config.timeframe}</span></div>
            <div className="kv-row"><span className="kv-k">range</span><span className="kv-v">{codeResult.portfolio_config.date_range[0]} → {codeResult.portfolio_config.date_range[1]}</span></div>
            <div className="kv-row"><span className="kv-k">code length</span><span className="kv-v">{codeResult.strategy_code.length} chars</span></div>
          </div>
        </div>
      )}
    </Stage>
  )
}
