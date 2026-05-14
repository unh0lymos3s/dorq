import { useCallback, useMemo, useState } from 'react'
import type React from 'react'
import type { StrategySpec, PortfolioConfig, BacktestResult } from '../types'

interface Props {
  mode: 'spec' | 'code'
  strategySpec: StrategySpec | null
  portfolioConfig: PortfolioConfig | null
  strategyCode: string | null
  onDone: (result: BacktestResult) => void
  done: boolean
  active: boolean
  animKey?: number
}

// ─── Module-scope style constants ──────────────────────────────────────────
const LOADING_SPAN: React.CSSProperties = { fontFamily: 'var(--mono)', fontSize: 13, letterSpacing: 3 }
const DOT_A: React.CSSProperties = { animation: 'pulse 1.2s ease infinite', animationDelay: '0ms' }
const DOT_B: React.CSSProperties = { animation: 'pulse 1.2s ease infinite', animationDelay: '200ms' }
const DOT_C: React.CSSProperties = { animation: 'pulse 1.2s ease infinite', animationDelay: '400ms' }

const LoadingDots = () => (
  <span style={LOADING_SPAN}>
    <span style={DOT_A}>•</span>
    <span style={DOT_B}>•</span>
    <span style={DOT_C}>•</span>
  </span>
)

function formatReturn(raw: number): string {
  // Compute once; avoid double `raw * 100`.
  const v = raw * 100
  if (v >= 0) return `+${v.toFixed(2)}%`
  return `−${(-v).toFixed(2)}%`
}

const CARD_ACTIVE: React.CSSProperties = { border: '2px solid var(--text)', position: 'relative', zIndex: 1, marginTop: -1, overflow: 'hidden' }
const CARD_DONE: React.CSSProperties = { border: '1px solid var(--border)', marginTop: -1, overflow: 'hidden' }
const CARD_IDLE: React.CSSProperties = { border: '1px solid var(--border)', marginTop: -1, overflow: 'hidden', opacity: 0.4 }

const HEADER_BASE: React.CSSProperties = {
  height: 52, padding: '0 20px', display: 'flex', alignItems: 'center', gap: 16,
}
const HEADER_ACTIVE: React.CSSProperties = { ...HEADER_BASE, background: 'var(--bg)' }
const HEADER_IDLE: React.CSSProperties = { ...HEADER_BASE, background: 'var(--surface)' }

const STEP_NUM_ACTIVE: React.CSSProperties = { fontSize: 28, fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--font)', lineHeight: 1, flexShrink: 0 }
const STEP_NUM_DONE: React.CSSProperties = { fontSize: 20, fontWeight: 800, color: 'var(--muted)', fontFamily: 'var(--font)', lineHeight: 1, textDecoration: 'line-through', flexShrink: 0 }
const STEP_NUM_IDLE: React.CSSProperties = { fontSize: 28, fontWeight: 800, color: 'var(--subtle)', fontFamily: 'var(--font)', lineHeight: 1, flexShrink: 0 }

const TITLE_STYLE: React.CSSProperties = {
  fontSize: 13, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
  color: 'var(--text)', flex: 1,
}

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase',
  color: 'var(--muted)', marginBottom: 6, marginTop: 16, display: 'block',
}

// CSS class .dorq-input handles :focus border — no per-field React state needed.
const INPUT_STYLE: React.CSSProperties = {
  height: 42, border: '1px solid var(--border)', borderRadius: 0, background: 'var(--bg)',
  color: 'var(--text)', padding: '0 12px', fontSize: 13, fontFamily: 'var(--font)',
  width: '100%', outline: 'none', transition: 'border-color 0.15s', boxSizing: 'border-box',
}

const BODY_STYLE: React.CSSProperties = {
  borderTop: '1px solid var(--border)',
  padding: '20px 20px 24px',
  animation: 'slideDown 0.22s ease',
}

const CONTEXT_BAR_STYLE: React.CSSProperties = {
  border: '1px solid var(--border)', padding: '10px 14px', marginBottom: 20,
  background: 'var(--surface)', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)',
  display: 'flex', gap: 20, flexWrap: 'wrap',
}

const BADGE_STYLE: React.CSSProperties = {
  fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--mono)', letterSpacing: '0.04em',
}

const ERROR_STYLE: React.CSSProperties = {
  margin: '10px 0 0', fontSize: 12, color: 'var(--error)', fontFamily: 'var(--mono)', letterSpacing: '0.02em',
}

export default function Step3Backtest({
  mode,
  strategySpec,
  portfolioConfig,
  strategyCode,
  onDone,
  done,
  active,
}: Props) {
  const [alpacaKey, setAlpacaKey] = useState('')
  const [alpacaSecret, setAlpacaSecret] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<BacktestResult | null>(null)

  const isDone = done || result !== null
  const isActive = active && !isDone

  const primaryBtnStyle = useMemo<React.CSSProperties>(() => ({
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
    opacity: loading ? 0.7 : 1,
  }), [loading])

  // Derive assets/timeframe once per render — no real cost, but avoid the
  // double-branching pattern by reading once.
  const source = mode === 'spec' ? strategySpec : portfolioConfig
  const assets = source?.assets ?? null
  const timeframe = source?.timeframe ?? ''

  const onKeyChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setAlpacaKey(e.target.value); setError(null)
  }, [])
  const onSecretChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setAlpacaSecret(e.target.value); setError(null)
  }, [])

  const handleRun = useCallback(async () => {
    const key = alpacaKey.trim()
    if (!key) { setError('Enter Alpaca API key.'); return }
    const secret = alpacaSecret.trim()
    if (!secret) { setError('Enter Alpaca secret key.'); return }
    setError(null)
    setLoading(true)
    try {
      const body: Record<string, unknown> = {
        mode,
        alpaca_api_key: key,
        alpaca_secret_key: secret,
      }
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
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || `HTTP ${res.status}`)
      }
      const data: BacktestResult = await res.json()
      setResult(data)
      onDone(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [alpacaKey, alpacaSecret, mode, strategySpec, strategyCode, portfolioConfig, onDone])

  const cardStyle = isActive ? CARD_ACTIVE : isDone ? CARD_DONE : CARD_IDLE
  const headerStyle = isActive ? HEADER_ACTIVE : HEADER_IDLE
  const stepNumberStyle = isActive ? STEP_NUM_ACTIVE : isDone ? STEP_NUM_DONE : STEP_NUM_IDLE

  // Compute badge once per render rather than calling a function twice.
  let badge: string | null = null
  if (result) {
    const totalReturn = result.metrics['total_return']
    badge = totalReturn != null ? formatReturn(totalReturn) : result.backtest_id
  }

  // Uppercased values for the context bar — derive once.
  const modeUpper = mode.toUpperCase()
  const assetsUpper = assets && assets.length > 0 ? assets.join(', ').toUpperCase() : null
  const timeframeUpper = timeframe ? timeframe.toUpperCase() : null

  return (
    <div style={cardStyle} className={isActive ? 'step-active' : undefined}>
      <div style={headerStyle}>
        <span style={stepNumberStyle}>3</span>
        <span style={TITLE_STYLE}>Run Backtest</span>
        {isDone && badge && <span style={BADGE_STYLE}>{badge}</span>}
      </div>

      {isActive && (
        <div style={BODY_STYLE}>
          {/* Context bar */}
          <div style={CONTEXT_BAR_STYLE}>
            <span>MODE: {modeUpper}</span>
            {assetsUpper && <span>ASSETS: {assetsUpper}</span>}
            {timeframeUpper && <span>TIMEFRAME: {timeframeUpper}</span>}
          </div>

          <label style={LABEL_STYLE}>Alpaca API Key</label>
          <input
            className="dorq-input"
            style={INPUT_STYLE}
            type="password"
            placeholder="APCA-API-KEY-ID"
            value={alpacaKey}
            onChange={onKeyChange}
          />

          <label style={LABEL_STYLE}>Alpaca Secret Key</label>
          <input
            className="dorq-input"
            style={INPUT_STYLE}
            type="password"
            placeholder="APCA-API-SECRET-KEY"
            value={alpacaSecret}
            onChange={onSecretChange}
          />

          <button style={primaryBtnStyle} onClick={handleRun} disabled={loading}>
            {loading ? <LoadingDots /> : 'Run Backtest'}
          </button>

          {error && <p style={ERROR_STYLE}>{error}</p>}
        </div>
      )}
    </div>
  )
}
