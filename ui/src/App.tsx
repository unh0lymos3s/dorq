import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { StrategySpec, PortfolioConfig, BacktestResult } from './types'
import Step1Paper from './steps/Step1Paper'
import Step2Strategy from './steps/Step2Strategy'
import Step3Backtest from './steps/Step3Backtest'
import Step4Results from './steps/Step4Results'

// SVG icons are pure; declare once as module-level constants so React reuses
// the same element on every render of the toggle button.
const SUN_ICON = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.5" />
    <line x1="8" y1="1" x2="8" y2="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <line x1="8" y1="13" x2="8" y2="15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <line x1="1" y1="8" x2="3" y2="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <line x1="13" y1="8" x2="15" y2="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <line x1="2.93" y1="2.93" x2="4.34" y2="4.34" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <line x1="11.66" y1="11.66" x2="13.07" y2="13.07" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <line x1="11.66" y1="4.34" x2="13.07" y2="2.93" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <line x1="2.93" y1="13.07" x2="4.34" y2="11.66" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
)

const MOON_ICON = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path
      d="M13.5 10.5A6 6 0 0 1 5.5 2.5a6 6 0 1 0 8 8z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

// Module-scope style constants — never re-allocated.
const THEME_TOGGLE_STYLE: React.CSSProperties = {
  position: 'fixed',
  top: 20,
  right: 20,
  width: 28,
  height: 28,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  cursor: 'pointer',
  padding: 0,
  lineHeight: 1,
  zIndex: 100,
  transition: 'background var(--transition)',
}

const SHELL_STYLE: React.CSSProperties = {
  maxWidth: 700,
  margin: '0 auto',
  padding: '56px 24px 100px',
}

const HEADER_BLOCK_STYLE: React.CSSProperties = { marginBottom: 32 }
const TITLE_STYLE: React.CSSProperties = {
  fontSize: 42,
  fontWeight: 800,
  letterSpacing: '-2px',
  color: 'var(--text)',
  margin: 0,
  lineHeight: 1,
}
const RULE_STYLE: React.CSSProperties = {
  height: 1,
  background: 'var(--border)',
  margin: '16px 0 8px',
}
const SUBTITLE_STYLE: React.CSSProperties = {
  color: 'var(--muted)',
  fontSize: 12,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  margin: 0,
}
const STEPS_STACK_STYLE: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 0 }

export default function App() {
  // Read prefers-color-scheme once at mount — also try localStorage so a manual
  // pick survives reload (the prior version always re-read the OS).
  const [dark, setDark] = useState(() => {
    if (typeof window === 'undefined') return false
    const stored = window.localStorage.getItem('dorq.theme')
    if (stored === 'dark') return true
    if (stored === 'light') return false
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)
  const [animKey, setAnimKey] = useState(0)
  const prevStep = useRef<number>(1)

  const [paperId, setPaperId] = useState<string | null>(null)
  const [strategyMode, setStrategyMode] = useState<'spec' | 'code'>('spec')
  const [strategySpec, setStrategySpec] = useState<StrategySpec | null>(null)
  const [portfolioConfig, setPortfolioConfig] = useState<PortfolioConfig | null>(null)
  const [strategyCode, setStrategyCode] = useState<string | null>(null)
  const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(null)

  // Single toggle (no branch) is cheaper than add/remove.
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    try { window.localStorage.setItem('dorq.theme', dark ? 'dark' : 'light') } catch {}
  }, [dark])

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setDark(e.matches)
    mediaQuery.addEventListener('change', handler)
    return () => mediaQuery.removeEventListener('change', handler)
  }, [])

  // useCallback so child components receive stable references — enables future
  // React.memo on step components without identity churn.
  const advanceStep = useCallback((next: 1 | 2 | 3 | 4) => {
    prevStep.current = next === 1 ? 1 : (next - 1) as 1 | 2 | 3
    setStep(next)
    setAnimKey(k => k + 1)
  }, [])

  const handleStep1Done = useCallback((id: string) => {
    setPaperId(id)
    advanceStep(2)
  }, [advanceStep])

  const handleStep2Done = useCallback((
    mode: 'spec' | 'code',
    spec: StrategySpec | null,
    config: PortfolioConfig | null,
    code: string | null,
  ) => {
    setStrategyMode(mode)
    setStrategySpec(spec)
    setPortfolioConfig(config)
    setStrategyCode(code)
    advanceStep(3)
  }, [advanceStep])

  const handleStep3Done = useCallback((result: BacktestResult) => {
    setBacktestResult(result)
    advanceStep(4)
  }, [advanceStep])

  const toggleDark = useCallback(() => setDark(d => !d), [])

  // Compute animKey props once per render to avoid inline ternaries duplicated
  // across four prop spots (and to make the dependency surface explicit).
  const step1AnimKey = step === 1 ? animKey : undefined
  const step2AnimKey = step === 2 ? animKey : undefined
  const step3AnimKey = step === 3 ? animKey : undefined
  const step4AnimKey = step === 4 ? animKey : undefined
  const step2Done = step > 2
  const step3Done = step > 3
  const step2Active = step >= 2
  const step3Active = step >= 3
  const step4Active = step >= 4

  // Memoize the icon node so the toggle button's children prop is stable.
  const themeIcon = useMemo(() => (dark ? SUN_ICON : MOON_ICON), [dark])

  return (
    <>
      <button
        onClick={toggleDark}
        style={THEME_TOGGLE_STYLE}
        className="theme-toggle"
        aria-label="Toggle theme"
      >
        {themeIcon}
      </button>

      <div style={SHELL_STYLE}>
        <div style={HEADER_BLOCK_STYLE}>
          <h1 style={TITLE_STYLE}>dorq</h1>
          <div style={RULE_STYLE} />
          <p style={SUBTITLE_STYLE}>
            Research Paper &rarr; Trading Strategy &rarr; Backtest
          </p>
        </div>

        <div style={STEPS_STACK_STYLE}>
          <Step1Paper
            onDone={handleStep1Done}
            done={step > 1}
            animKey={step1AnimKey}
          />
          <Step2Strategy
            paperId={paperId}
            onDone={handleStep2Done}
            done={step2Done}
            active={step2Active}
            animKey={step2AnimKey}
          />
          <Step3Backtest
            mode={strategyMode}
            strategySpec={strategySpec}
            portfolioConfig={portfolioConfig}
            strategyCode={strategyCode}
            onDone={handleStep3Done}
            done={step3Done}
            active={step3Active}
            animKey={step3AnimKey}
          />
          <Step4Results
            result={backtestResult}
            active={step4Active}
            animKey={step4AnimKey}
          />
        </div>
      </div>
    </>
  )
}
