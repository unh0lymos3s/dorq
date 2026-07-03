import { useCallback, useState } from 'react'
import type { StrategySpec, PortfolioConfig, CodeStrategyResult } from '../types'
import { friendlyError } from '../apiError'
import Stage, { Working, type StageState } from '../components/Stage'

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

/** One condition per line ⇄ list of condition strings. */
const toLines = (conditions: string[]) => conditions.join('\n')
const fromLines = (text: string) => text.split('\n').map(s => s.trim()).filter(Boolean)

function indicatorLabel(name: string, params: Record<string, unknown>): string {
  const values = Object.values(params).filter(v => typeof v === 'number' || typeof v === 'string')
  return values.length ? `${name} ${values.join('/')}` : name
}

export default function Step2Strategy({ state, paperId, onDone }: Props) {
  const [tab, setTab] = useState<'spec' | 'code'>('spec')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [specResult, setSpecResult] = useState<StrategySpec | null>(null)
  const [codeResult, setCodeResult] = useState<CodeStrategyResult | null>(null)
  // Raw textarea contents so the user can have blank lines mid-edit; the
  // parsed conditions flow upward on every keystroke.
  const [entryText, setEntryText] = useState('')
  const [exitText, setExitText] = useState('')

  const publishSpec = useCallback((spec: StrategySpec) => {
    setSpecResult(spec)
    onDone('spec', spec, null, null)
  }, [onDone])

  const handleConditionEdit = useCallback((which: 'entry' | 'exit', text: string) => {
    if (which === 'entry') setEntryText(text)
    else setExitText(text)
    setSpecResult(prev => {
      if (!prev) return prev
      const updated = {
        ...prev,
        [which === 'entry' ? 'entry_conditions' : 'exit_conditions']: fromLines(text),
      }
      onDone('spec', updated, null, null)
      return updated
    })
  }, [onDone])

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
        setCodeResult(null)
        setEntryText(toLines(data.entry_conditions))
        setExitText(toLines(data.exit_conditions))
        publishSpec(data)
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
  }, [paperId, tab, onDone, publishSpec])

  const hasResult = specResult !== null || codeResult !== null
  const badge = specResult
    ? (specResult.title || 'spec')
    : codeResult
    ? `code · ${codeResult.strategy_code.length} chars`
    : undefined

  const conditionsValid = !specResult
    || (specResult.entry_conditions.length > 0 && specResult.exit_conditions.length > 0)

  return (
    <Stage n={2} title="Generate strategy" state={state} badge={badge}>
      {state === 'active' && !hasResult && (
        <div className="card-body">
          <div className="tabs" role="tablist">
            <button className={`tab${tab === 'spec' ? ' is-on' : ''}`} onClick={() => setTab('spec')}>Strategy spec</button>
            <button className={`tab${tab === 'code' ? ' is-on' : ''}`} onClick={() => setTab('code')}>Code strategy</button>
          </div>

          <p className="note">
            {tab === 'spec'
              ? 'The model extracts indicators and entry/exit rules the deterministic engine can run.'
              : 'The model writes a sandboxed pandas strategy() function you can inspect and edit.'}
          </p>

          <button className="btn" onClick={handleGenerate} disabled={loading}>
            {loading ? <Working label="reading paper" /> : 'Generate'}
          </button>
          {error && <p className="error">{error}</p>}
        </div>
      )}

      {specResult && (
        <div className="card-foot">
          <div className="summary-title">{specResult.title}</div>
          <div className="summary-text">{specResult.summary}</div>

          {specResult.indicators.length > 0 && (
            <div className="context">
              {specResult.indicators.map((ind, i) => (
                <span className="chip" key={i}><b>{indicatorLabel(ind.name, ind.params)}</b></span>
              ))}
            </div>
          )}

          <div className="cond-grid">
            <label className="field">
              <span className="field-label">Entry conditions · one per line</span>
              <textarea
                className="code-box cond-box"
                spellCheck={false}
                value={entryText}
                onChange={e => handleConditionEdit('entry', e.target.value)}
              />
            </label>
            <label className="field">
              <span className="field-label">Exit conditions · one per line</span>
              <textarea
                className="code-box cond-box"
                spellCheck={false}
                value={exitText}
                onChange={e => handleConditionEdit('exit', e.target.value)}
              />
            </label>
          </div>
          <p className="note">
            Format: <code>SMA_50 &gt; SMA_200</code> — combine with <code>AND</code>/<code>OR</code>.
            Edits apply to the next backtest run.
          </p>
          {!conditionsValid && <p className="error">Entry and exit conditions can't be empty.</p>}

          <button className="btn btn-ghost" onClick={handleGenerate} disabled={loading}>
            {loading ? <Working label="regenerating" /> : 'Regenerate from paper'}
          </button>
          {error && <p className="error">{error}</p>}
        </div>
      )}

      {codeResult && (
        <div className="card-foot">
          <div className="summary-title">Code strategy</div>
          <div className="kv">
            <div className="kv-row"><span className="kv-k">assets</span><span className="kv-v">{codeResult.portfolio_config.assets.join(', ')}</span></div>
            <div className="kv-row"><span className="kv-k">timeframe</span><span className="kv-v">{codeResult.portfolio_config.timeframe}</span></div>
            <div className="kv-row"><span className="kv-k">range</span><span className="kv-v">{codeResult.portfolio_config.date_range[0]} → {codeResult.portfolio_config.date_range[1]}</span></div>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="strategy-code-box">strategy_code · editable</label>
            <textarea
              id="strategy-code-box"
              className="code-box"
              spellCheck={false}
              value={codeResult.strategy_code}
              onChange={e => handleCodeEdit(e.target.value)}
            />
          </div>
          <button className="btn btn-ghost" onClick={handleGenerate} disabled={loading}>
            {loading ? <Working label="regenerating" /> : 'Regenerate from paper'}
          </button>
          {error && <p className="error">{error}</p>}
        </div>
      )}
    </Stage>
  )
}
