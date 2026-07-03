import { useCallback, useState } from 'react'
import type { StrategySpec, PortfolioConfig, CodeStrategyResult } from '../types'
import { friendlyError } from '../apiError'
import Stage, { Dots, type StageState } from '../components/Stage'

interface Props {
  state: StageState
  paperId: string | null
  onDone: (
    mode: 'spec' | 'code',
    spec: StrategySpec | null,
    config: PortfolioConfig | null,
    code: string | null,
  ) => void
}

export default function Step2Strategy({ state, paperId, onDone }: Props) {
  const [tab, setTab] = useState<'spec' | 'code'>('spec')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [specResult, setSpecResult] = useState<StrategySpec | null>(null)
  const [codeResult, setCodeResult] = useState<CodeStrategyResult | null>(null)

  const handleCodeEdit = useCallback((next: string) => {
    setCodeResult(prev => {
      if (!prev) return prev
      const updated = { ...prev, strategy_code: next }
      onDone('code', null, updated.portfolio_config, next)
      return updated
    })
  }, [onDone])

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

          <button className="btn" onClick={handleGenerate} disabled={loading}>
            {loading ? <Dots /> : 'Generate'}
          </button>
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
          <div className="field">
            <label className="field-label" htmlFor="strategy-code-box">strategy_code</label>
            <textarea
              id="strategy-code-box"
              className="code-box"
              spellCheck={false}
              value={codeResult.strategy_code}
              onChange={e => handleCodeEdit(e.target.value)}
            />
          </div>
        </div>
      )}
    </Stage>
  )
}
