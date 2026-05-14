import { useCallback, useMemo, useState } from 'react'
import type React from 'react'
import type { StrategySpec, PortfolioConfig, CodeStrategyResult } from '../types'
import { friendlyError } from '../apiError'

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
  animKey?: number
}

const PROVIDERS = ['openai', 'anthropic', 'groq', 'gemini', 'azure', 'bedrock', 'ollama'] as const

// ─── Module-scope style constants ──────────────────────────────────────────
const HEADER_BASE: React.CSSProperties = {
  height: 52,
  display: 'flex',
  alignItems: 'center',
  gap: 16,
  padding: '0 20px',
}
const HEADER_ACTIVE: React.CSSProperties = { ...HEADER_BASE, background: 'var(--bg)' }
const HEADER_IDLE: React.CSSProperties = { ...HEADER_BASE, background: 'var(--surface)' }

const STEP_NUM_DONE: React.CSSProperties = {
  fontSize: 20, fontWeight: 800, fontFamily: 'var(--font)', color: 'var(--muted)',
  lineHeight: 1, minWidth: 32, textDecoration: 'line-through', textDecorationColor: 'var(--border)',
}
const STEP_NUM_ACTIVE: React.CSSProperties = {
  fontSize: 28, fontWeight: 800, fontFamily: 'var(--font)', color: 'var(--text)',
  lineHeight: 1, minWidth: 32,
}
const STEP_NUM_IDLE: React.CSSProperties = {
  fontSize: 28, fontWeight: 800, fontFamily: 'var(--font)', color: 'var(--subtle)',
  lineHeight: 1, minWidth: 32,
}

const TITLE_BASE: React.CSSProperties = {
  fontSize: 13, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', flex: 1,
}
const TITLE_ACTIVE: React.CSSProperties = { ...TITLE_BASE, color: 'var(--text)' }
const TITLE_IDLE: React.CSSProperties = { ...TITLE_BASE, color: 'var(--muted)' }

const INPUT_STYLE: React.CSSProperties = {
  height: 42, border: '1px solid var(--border)', borderRadius: 0, background: 'var(--bg)',
  color: 'var(--text)', padding: '0 12px', fontSize: 13, fontFamily: 'var(--font)',
  width: '100%', boxSizing: 'border-box', outline: 'none', transition: 'border-color 0.15s',
}
const SELECT_STYLE: React.CSSProperties = {
  ...INPUT_STYLE,
  appearance: 'none',
  WebkitAppearance: 'none',
  paddingRight: 32,
  cursor: 'pointer',
}

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase',
  color: 'var(--muted)', marginBottom: 6, marginTop: 16, display: 'block',
}

const BODY_STYLE: React.CSSProperties = {
  padding: '20px 20px 24px',
  borderTop: '1px solid var(--border)',
  animation: 'slideDown 0.22s ease',
}

const TAB_WRAP_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  border: '1px solid var(--border)',
  marginBottom: 18,
}
const TAB_BTN_BASE: React.CSSProperties = {
  padding: '8px 16px', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
  textTransform: 'uppercase', border: 'none', cursor: 'pointer', fontFamily: 'var(--font)',
  transition: 'background 0.15s, color 0.15s',
}
const TAB_BTN_ON: React.CSSProperties = { ...TAB_BTN_BASE, background: 'var(--text)', color: 'var(--bg)' }
const TAB_BTN_OFF: React.CSSProperties = { ...TAB_BTN_BASE, background: 'transparent', color: 'var(--muted)' }

const SELECT_WRAP_STYLE: React.CSSProperties = { position: 'relative' }
const SELECT_CARET_STYLE: React.CSSProperties = {
  position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
  pointerEvents: 'none', color: 'var(--muted)', fontSize: 11, fontFamily: 'var(--mono)',
}

const BADGE_STYLE: React.CSSProperties = {
  fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', maxWidth: 220,
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
}

const LOADING_SPAN: React.CSSProperties = { fontFamily: 'var(--mono)', fontSize: 13, letterSpacing: 3 }
const DOT_A: React.CSSProperties = { animation: 'pulse 1.2s ease infinite', animationDelay: '0ms', display: 'inline-block' }
const DOT_B: React.CSSProperties = { animation: 'pulse 1.2s ease infinite', animationDelay: '200ms', display: 'inline-block' }
const DOT_C: React.CSSProperties = { animation: 'pulse 1.2s ease infinite', animationDelay: '400ms', display: 'inline-block' }

const ERROR_STYLE: React.CSSProperties = {
  marginTop: 10, fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--error)',
}

const SPEC_WRAP_STYLE: React.CSSProperties = {
  borderTop: '1px solid var(--border)', background: 'var(--surface)',
}
const SPEC_HEAD_STYLE: React.CSSProperties = { padding: '16px 20px 0' }
const SPEC_TITLE_STYLE: React.CSSProperties = {
  fontSize: 13, fontWeight: 600, fontFamily: 'var(--font)', color: 'var(--text)', marginBottom: 4,
}
const SPEC_SUMMARY_STYLE: React.CSSProperties = {
  fontSize: 12, color: 'var(--muted)', fontStyle: 'italic', lineHeight: 1.6, marginBottom: 12,
}
const SPEC_DATA_STYLE: React.CSSProperties = {
  borderTop: '1px solid var(--border)', padding: '12px 20px',
  fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)', lineHeight: 2,
}
const SPEC_TOGGLE_BTN_STYLE: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)',
  fontSize: 10, fontFamily: 'var(--mono)', fontWeight: 700, letterSpacing: '0.06em',
  textTransform: 'uppercase', padding: 0,
}

const CODE_RESULT_WRAP_STYLE: React.CSSProperties = {
  borderTop: '1px solid var(--border)', padding: '16px 20px', background: 'var(--surface)',
  fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)', lineHeight: 2,
}
const CODE_LABEL_STYLE: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
  color: 'var(--muted)', marginBottom: 8,
}

const ROW_STYLE: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 16 }
const ROW_VALUE_STYLE: React.CSSProperties = {
  color: 'var(--text)', fontWeight: 700, textAlign: 'right', overflow: 'hidden',
  textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%',
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={ROW_STYLE}>
      <span>{label}</span>
      <span style={ROW_VALUE_STYLE}>{value}</span>
    </div>
  )
}

// Provider options precomputed once for the lifetime of the bundle.
const PROVIDER_OPTIONS = PROVIDERS.map(p => (
  <option key={p} value={p}>{p}</option>
))

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
  const isIdle = !active && !isDone

  // Card shell needs `isActive`/`isIdle`; memoize so the prop is stable when
  // unrelated state (model/apiKey typing) changes.
  const cardStyle = useMemo<React.CSSProperties>(() => ({
    border: isActive ? '2px solid var(--text)' : '1px solid var(--border)',
    marginTop: -1,
    position: isActive ? 'relative' : undefined,
    zIndex: isActive ? 1 : undefined,
    overflow: 'hidden',
    opacity: isIdle ? 0.4 : 1,
  }), [isActive, isIdle])

  const generateBtnStyle = useMemo<React.CSSProperties>(() => ({
    width: '100%',
    height: 44,
    background: 'var(--text)',
    color: 'var(--bg)',
    border: 'none',
    fontFamily: 'var(--font)',
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    cursor: loading ? 'not-allowed' : 'pointer',
    marginTop: 20,
    transition: 'opacity 0.15s',
    opacity: loading ? 0.5 : 1,
  }), [loading])

  const onProviderChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setProvider(e.target.value)
  }, [])

  const onModelChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setModel(e.target.value)
    setError(null)
  }, [])

  const onApiKeyChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setApiKey(e.target.value)
    setError(null)
  }, [])

  const toggleSpecOpen = useCallback(() => setSpecOpen(o => !o), [])

  const handleGenerate = useCallback(async () => {
    if (!paperId) { setError('No paper loaded.'); return }
    const m = model.trim()
    if (!m) { setError('Enter a model name.'); return }
    const k = apiKey.trim()
    if (!k) { setError('Enter an API key.'); return }
    setError(null)
    setLoading(true)
    try {
      const endpoint = tab === 'spec' ? '/strategies/generate' : '/strategies/generate-code'
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paper_id: paperId, provider, model: m, api_key: k }),
      })
      if (!res.ok) throw await friendlyError(res)
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
  }, [paperId, model, apiKey, tab, provider, onDone])

  const headerStyle = isActive ? HEADER_ACTIVE : HEADER_IDLE
  const titleStyle = isActive ? TITLE_ACTIVE : TITLE_IDLE
  const stepNumStyle = isDone ? STEP_NUM_DONE : isActive ? STEP_NUM_ACTIVE : STEP_NUM_IDLE

  const headerBadgeText = specResult
    ? (specResult.title || 'spec')
    : codeResult
    ? `code · ${codeResult.strategy_code.length} chars`
    : null

  // Style for the spec-toggle row depends on `specOpen`; cheap to inline-memoize.
  const specToggleRowStyle = useMemo<React.CSSProperties>(() => ({
    display: 'flex',
    justifyContent: 'flex-end',
    padding: '6px 20px 10px',
    borderTop: specOpen ? '1px solid var(--border)' : undefined,
  }), [specOpen])

  return (
    <div style={cardStyle} className={isActive ? 'step-active' : undefined}>
      {/* ── Header ── */}
      <div style={headerStyle}>
        <span style={stepNumStyle}>2</span>
        <span style={titleStyle}>Generate Strategy</span>
        {isDone && headerBadgeText && <span style={BADGE_STYLE}>{headerBadgeText}</span>}
      </div>

      {/* ── Active body ── */}
      {isActive && (
        <div style={BODY_STYLE}>
          {/* Generation mode tab switcher */}
          <div style={TAB_WRAP_STYLE}>
            <button
              onClick={() => setTab('spec')}
              style={tab === 'spec' ? TAB_BTN_ON : TAB_BTN_OFF}
            >
              Strategy Spec
            </button>
            <button
              onClick={() => setTab('code')}
              style={tab === 'code' ? TAB_BTN_ON : TAB_BTN_OFF}
            >
              Code Strategy
            </button>
          </div>

          {/* Provider select */}
          <label style={LABEL_STYLE}>Provider</label>
          <div style={SELECT_WRAP_STYLE}>
            <select
              className="dorq-select"
              style={SELECT_STYLE}
              value={provider}
              onChange={onProviderChange}
            >
              {PROVIDER_OPTIONS}
            </select>
            <span style={SELECT_CARET_STYLE}>▾</span>
          </div>

          {/* Model */}
          <label style={LABEL_STYLE}>Model</label>
          <input
            className="dorq-input"
            style={INPUT_STYLE}
            type="text"
            placeholder="e.g. gpt-4o, claude-sonnet-4-6"
            value={model}
            onChange={onModelChange}
          />

          {/* API Key */}
          <label style={LABEL_STYLE}>API Key</label>
          <input
            className="dorq-input"
            style={INPUT_STYLE}
            type="password"
            placeholder="sk-…"
            value={apiKey}
            onChange={onApiKeyChange}
          />

          <button style={generateBtnStyle} onClick={handleGenerate} disabled={loading}>
            {loading ? (
              <span style={LOADING_SPAN}>
                <span style={DOT_A}>•</span>
                <span style={DOT_B}>•</span>
                <span style={DOT_C}>•</span>
              </span>
            ) : (
              'Generate'
            )}
          </button>

          {error && <p style={ERROR_STYLE}>! {error}</p>}
        </div>
      )}

      {/* ── Spec result info block ── */}
      {specResult !== null && (
        <div style={SPEC_WRAP_STYLE}>
          <div style={SPEC_HEAD_STYLE}>
            <div style={SPEC_TITLE_STYLE}>{specResult.title}</div>
            {specOpen && <div style={SPEC_SUMMARY_STYLE}>{specResult.summary}</div>}
          </div>

          {specOpen && (
            <div style={SPEC_DATA_STYLE}>
              <InfoRow label="assets" value={specResult.assets.join(', ')} />
              <InfoRow label="timeframe" value={specResult.timeframe} />
              <InfoRow label="range" value={`${specResult.date_range[0]} → ${specResult.date_range[1]}`} />
            </div>
          )}

          <div style={specToggleRowStyle}>
            <button onClick={toggleSpecOpen} style={SPEC_TOGGLE_BTN_STYLE}>
              {specOpen ? 'COLLAPSE −' : 'EXPAND +'}
            </button>
          </div>
        </div>
      )}

      {/* ── Code result info block ── */}
      {codeResult !== null && (
        <div style={CODE_RESULT_WRAP_STYLE}>
          <div style={CODE_LABEL_STYLE}>CODE STRATEGY</div>
          <InfoRow label="assets" value={codeResult.portfolio_config.assets.join(', ')} />
          <InfoRow label="timeframe" value={codeResult.portfolio_config.timeframe} />
          <InfoRow label="range" value={`${codeResult.portfolio_config.date_range[0]} → ${codeResult.portfolio_config.date_range[1]}`} />
          <InfoRow label="code length" value={`${codeResult.strategy_code.length} chars`} />
        </div>
      )}
    </div>
  )
}
