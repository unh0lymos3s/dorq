import { useState } from 'react'
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
}

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

  const runBtn: React.CSSProperties = {
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

  async function handleRun() {
    if (!alpacaKey.trim()) { setError('Enter Alpaca API key.'); return }
    if (!alpacaSecret.trim()) { setError('Enter Alpaca secret key.'); return }
    setError(null)
    setLoading(true)
    try {
      const body: Record<string, unknown> = {
        mode,
        alpaca_api_key: alpacaKey.trim(),
        alpaca_secret_key: alpacaSecret.trim(),
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
  }

  function headerBadge() {
    if (!result) return null
    const totalReturn = result.metrics['total_return']
    if (totalReturn != null) {
      return `${totalReturn >= 0 ? '+' : ''}${(totalReturn * 100).toFixed(2)}%`
    }
    return result.backtest_id
  }

  return (
    <div style={cardStyle}>
      <div style={headerStyle}>
        <div style={cirStyle}>{isDone ? '✓' : '3'}</div>
        <span style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>Run Backtest</span>
        {isDone && headerBadge() && (
          <span style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
            {headerBadge()}
          </span>
        )}
      </div>

      {isActive && (
        <div style={{ padding: '0 16px 16px' }}>
          <p style={{ margin: '8px 0 12px', fontSize: 13, color: 'var(--muted)' }}>
            Mode: <strong style={{ color: 'var(--text)' }}>{mode}</strong>
            {mode === 'spec' && strategySpec && (
              <> · {strategySpec.assets.join(', ')} · {strategySpec.timeframe}</>
            )}
            {mode === 'code' && portfolioConfig && (
              <> · {portfolioConfig.assets.join(', ')} · {portfolioConfig.timeframe}</>
            )}
          </p>

          <label style={labelStyle}>Alpaca API Key</label>
          <input
            style={sharedInput()}
            type="password"
            placeholder="APCA-API-KEY-ID"
            value={alpacaKey}
            onChange={e => { setAlpacaKey(e.target.value); setError(null) }}
          />

          <label style={labelStyle}>Alpaca Secret Key</label>
          <input
            style={sharedInput()}
            type="password"
            placeholder="APCA-API-SECRET-KEY"
            value={alpacaSecret}
            onChange={e => { setAlpacaSecret(e.target.value); setError(null) }}
          />

          <button style={runBtn} onClick={handleRun} disabled={loading}>
            {loading ? 'Running…' : 'Run Backtest'}
          </button>

          {error && (
            <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--error, #cc0000)' }}>
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
