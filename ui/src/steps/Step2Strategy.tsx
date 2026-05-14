import { useState } from 'react'
import type React from 'react'
import type { StrategySpec, PortfolioConfig, CodeStrategyResult } from '../types'

interface Props {
  paperId: string | null
  onDone: (
    mode: 'spec' | 'code',
    spec: StrategySpec | null,
    config: PortfolioConfig | null,
    code: string | null,
  ) => void
  done: boolean
  active: boolean
}

const PROVIDERS = ['openai', 'anthropic', 'groq', 'gemini', 'azure', 'bedrock', 'ollama'] as const

const CIRCLE: React.CSSProperties = {
  width: 24,
  height: 24,
  borderRadius: '50%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 11,
  fontWeight: 700,
  flexShrink: 0,
  background: 'var(--text)',
  color: 'var(--bg)',
  border: 'none',
}

const CIRCLE_IDLE: React.CSSProperties = {
  ...CIRCLE,
  background: 'transparent',
  color: 'var(--muted)',
  border: '1.5px solid var(--border)',
}

function sharedInput(): React.CSSProperties {
  return {
    width: '100%',
    height: 38,
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    background: 'var(--surface)',
    color: 'var(--text)',
    padding: '0 10px',
    fontSize: 13,
    fontFamily: 'var(--font)',
    boxSizing: 'border-box',
    outline: 'none',
  }
}

export default function Step2Strategy({ paperId, onDone, done, active }: Props) {
  const [tab, setTab] = useState<'spec' | 'code'>('spec')
  const [provider, setProvider] = useState('openai')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [specResult, setSpecResult] = useState<StrategySpec | null>(null)
  const [codeResult, setCodeResult] = useState<CodeStrategyResult | null>(null)
  const [specOpen, setSpecOpen] = useState(true)

  const isDone = done || specResult !== null || codeResult !== null
  const isActive = active && !isDone

  const cardStyle: React.CSSProperties = {
    border: isActive
      ? '2px solid var(--text)'
      : '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    overflow: 'hidden',
    opacity: !active && !isDone ? 0.45 : 1,
  }

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '12px 16px',
    background: 'var(--surface)',
  }

  const cirStyle = isDone || isActive ? CIRCLE : CIRCLE_IDLE

  const tabBtnStyle = (t: boolean): React.CSSProperties => ({
    background: 'none',
    border: 'none',
    borderBottom: t ? '2px solid var(--text)' : '2px solid transparent',
    padding: '6px 2px',
    marginRight: 16,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: t ? 600 : 400,
    color: t ? 'var(--text)' : 'var(--muted)',
    fontFamily: 'var(--font)',
  })

  const generateBtn: React.CSSProperties = {
    width: '100%',
    height: 40,
    background: 'var(--text)',
    color: 'var(--bg)',
    border: 'none',
    borderRadius: 'var(--radius)',
    fontSize: 14,
    fontWeight: 600,
    cursor: loading ? 'not-allowed' : 'pointer',
    opacity: loading ? 0.6 : 1,
    fontFamily: 'var(--font)',
    marginTop: 12,
  }

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 12,
    color: 'var(--muted)',
    marginBottom: 4,
    marginTop: 10,
    fontWeight: 500,
  }

  const infoBlock: React.CSSProperties = {
    marginTop: 12,
    padding: '10px 12px',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    fontSize: 12,
    color: 'var(--muted)',
    background: 'var(--subtle)',
    lineHeight: 1.7,
  }

  const collapseBtn: React.CSSProperties = {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: 'var(--muted)',
    fontSize: 12,
    fontFamily: 'var(--font)',
    padding: 0,
    marginLeft: 'auto',
  }

  async function handleGenerate() {
    if (!paperId) { setError('No paper loaded.'); return }
    const m = model.trim()
    if (!m) { setError('Enter a model name.'); return }
    if (!apiKey.trim()) { setError('Enter an API key.'); return }
    setError(null)
    setLoading(true)
    try {
      const endpoint = tab === 'spec' ? '/strategies/generate' : '/strategies/generate-code'
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paper_id: paperId, provider, model: m, api_key: apiKey.trim() }),
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || `HTTP ${res.status}`)
      }
      if (tab === 'spec') {
        const data: StrategySpec = await res.json()
        setSpecResult(data)
        setCodeResult(null)
        onDone('spec', data, null, null)
      } else {
        const data: CodeStrategyResult = await res.json()
        setCodeResult(data)
        setSpecResult(null)
        onDone('code', null, data.portfolio_config, data.strategy_code)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  function headerBadge() {
    if (specResult) return specResult.title || 'spec'
    if (codeResult) return `code · ${codeResult.strategy_code.length} chars`
    return null
  }

  return (
    <div style={cardStyle}>
      <div style={headerStyle}>
        <div style={cirStyle}>{isDone ? '✓' : '2'}</div>
        <span style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>Generate Strategy</span>
        {isDone && headerBadge() && (
          <span style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--mono)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {headerBadge()}
          </span>
        )}
      </div>

      {isActive && (
        <div style={{ padding: '0 16px 16px' }}>
          {/* Generation mode tab */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 14, marginTop: 2 }}>
            <button style={tabBtnStyle(tab === 'spec')} onClick={() => setTab('spec')}>Strategy Spec</button>
            <button style={tabBtnStyle(tab === 'code')} onClick={() => setTab('code')}>Code Strategy</button>
          </div>

          <label style={labelStyle}>Provider</label>
          <select
            style={{ ...sharedInput(), appearance: 'none', WebkitAppearance: 'none' }}
            value={provider}
            onChange={e => setProvider(e.target.value)}
          >
            {PROVIDERS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>

          <label style={labelStyle}>Model</label>
          <input
            style={sharedInput()}
            type="text"
            placeholder="e.g. gpt-4o, claude-sonnet-4-6"
            value={model}
            onChange={e => { setModel(e.target.value); setError(null) }}
          />

          <label style={labelStyle}>API Key</label>
          <input
            style={sharedInput()}
            type="password"
            placeholder="sk-…"
            value={apiKey}
            onChange={e => { setApiKey(e.target.value); setError(null) }}
          />

          <button style={generateBtn} onClick={handleGenerate} disabled={loading}>
            {loading ? 'Generating…' : 'Generate'}
          </button>

          {error && (
            <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--error, #cc0000)' }}>
              {error}
            </p>
          )}
        </div>
      )}

      {specResult !== null && (
        <div style={{ padding: '0 16px 12px' }}>
          <div style={infoBlock}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontWeight: 600, color: 'var(--text)', fontSize: 13 }}>{specResult.title}</span>
              <button style={collapseBtn} onClick={() => setSpecOpen(o => !o)}>
                {specOpen ? '▲ collapse' : '▼ expand'}
              </button>
            </div>
            {specOpen && (
              <>
                <div style={{ marginBottom: 4, color: 'var(--muted)' }}>{specResult.summary}</div>
                <div>assets: {specResult.assets.join(', ')}</div>
                <div>timeframe: {specResult.timeframe}</div>
                <div>range: {specResult.date_range[0]} → {specResult.date_range[1]}</div>
              </>
            )}
          </div>
        </div>
      )}

      {codeResult !== null && (
        <div style={{ padding: '0 16px 12px' }}>
          <div style={infoBlock}>
            <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: 13, marginBottom: 4 }}>Code Strategy</div>
            <div>assets: {codeResult.portfolio_config.assets.join(', ')}</div>
            <div>timeframe: {codeResult.portfolio_config.timeframe}</div>
            <div>range: {codeResult.portfolio_config.date_range[0]} → {codeResult.portfolio_config.date_range[1]}</div>
            <div>code: {codeResult.strategy_code.length} chars</div>
          </div>
        </div>
      )}
    </div>
  )
}
