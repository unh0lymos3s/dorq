import { useCallback, useEffect, useState } from 'react'
import type { StrategySpec, PortfolioConfig, BacktestResult, RunEntry, ServerConfig } from './types'
import Dither from './components/Dither'
import BackgroundBoundary from './components/BackgroundBoundary'
import Step1Paper from './steps/Step1Paper'
import Step2Strategy from './steps/Step2Strategy'
import Step3Backtest from './steps/Step3Backtest'
import Step4Results from './steps/Step4Results'

const SUN = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
  </svg>
)
const MOON = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </svg>
)

function runLabel(result: BacktestResult): string {
  const assets = Object.keys(result.price_series ?? {})
  return assets.length ? assets.slice(0, 3).join(' ') : new Date().toLocaleTimeString()
}

export default function App() {
  // Dark-first: honour a stored choice, otherwise default to dark.
  const [light, setLight] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem('dorq.theme') === 'light'
  })

  const [config, setConfig] = useState<ServerConfig | null>(null)

  const [paperId, setPaperId] = useState<string | null>(null)
  const [strategyMode, setStrategyMode] = useState<'spec' | 'code'>('spec')
  const [strategySpec, setStrategySpec] = useState<StrategySpec | null>(null)
  const [portfolioConfig, setPortfolioConfig] = useState<PortfolioConfig | null>(null)
  const [strategyCode, setStrategyCode] = useState<string | null>(null)

  // Every completed backtest in this session; the user flips between them
  // in the results step to compare parameter tweaks. Kept as one object so
  // appending a run and selecting it is a single atomic update.
  const [runState, setRunState] = useState<{ runs: RunEntry[]; active: number }>({ runs: [], active: 0 })
  const { runs, active: activeRun } = runState
  const backtestResult = runs[activeRun]?.result ?? null

  // Remounting the pipeline via `key` resets all step-local state at once.
  const [sessionKey, setSessionKey] = useState(0)

  useEffect(() => {
    document.documentElement.classList.toggle('light', light)
    try { window.localStorage.setItem('dorq.theme', light ? 'light' : 'dark') } catch {}
  }, [light])

  useEffect(() => {
    let alive = true
    fetch('/config')
      .then(r => (r.ok ? r.json() : null))
      .then(c => { if (alive && c) setConfig(c) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  const toggleTheme = useCallback(() => setLight(v => !v), [])

  const handleReset = useCallback(() => {
    setPaperId(null)
    setStrategySpec(null)
    setPortfolioConfig(null)
    setStrategyCode(null)
    setStrategyMode('spec')
    setRunState({ runs: [], active: 0 })
    setSessionKey(k => k + 1)
  }, [])

  const handleStep1Done = useCallback((id: string) => setPaperId(id), [])

  const handleStep2Done = useCallback((
    mode: 'spec' | 'code',
    spec: StrategySpec | null,
    pc: PortfolioConfig | null,
    code: string | null,
  ) => {
    setStrategyMode(mode)
    setStrategySpec(spec)
    setPortfolioConfig(pc)
    setStrategyCode(code)
  }, [])

  const handleStep3Done = useCallback((result: BacktestResult) => {
    setRunState(prev => {
      const next = [...prev.runs, { result, label: runLabel(result), at: Date.now() }]
      return { runs: next, active: next.length - 1 }
    })
  }, [])

  const handleSelectRun = useCallback((idx: number) => {
    setRunState(prev => ({ ...prev, active: idx }))
  }, [])

  const hasStrategy = strategySpec !== null || strategyCode !== null

  // Stage states drive the pipeline spine.
  const s1: 'idle' | 'active' | 'done' = paperId ? 'done' : 'active'
  const s2: 'idle' | 'active' | 'done' = hasStrategy ? 'done' : paperId ? 'active' : 'idle'
  const s3: 'idle' | 'active' | 'done' = backtestResult ? 'done' : hasStrategy ? 'active' : 'idle'
  const s4: 'idle' | 'active' | 'done' = backtestResult ? 'active' : 'idle'

  return (
    <>
      <div className="dither-bg" aria-hidden="true">
        <BackgroundBoundary>
          <Dither
            waveColor={[0.5, 0.5, 0.5]}
            enableMouseInteraction
            mouseRadius={0.3}
            colorNum={4}
            waveAmplitude={0.3}
            waveFrequency={3}
            waveSpeed={0.05}
          />
        </BackgroundBoundary>
      </div>
      <div className="app">
        <header className="topbar">
          <div className="brand">dorq</div>
          <div className="topbar-right">
            {config && (
              <span className="status-pill" title="Local model serving this app">
                <span className={`dot${config.alpaca_configured ? '' : ' off'}`} />
                {config.ollama_model} · ollama
              </span>
            )}
            {paperId && (
              <button className="icon-btn text-btn" onClick={handleReset} title="Start over with a new paper">
                new paper
              </button>
            )}
            <button className="icon-btn" onClick={toggleTheme} aria-label="Toggle theme">
              {light ? MOON : SUN}
            </button>
          </div>
        </header>

        <main className="stage-wrap">
          <div className="pipeline" key={sessionKey}>
            <Step1Paper state={s1} onDone={handleStep1Done} />
            <Step2Strategy
              state={s2}
              paperId={paperId}
              onDone={handleStep2Done}
            />
            <Step3Backtest
              state={s3}
              mode={strategyMode}
              strategySpec={strategySpec}
              portfolioConfig={portfolioConfig}
              strategyCode={strategyCode}
              alpacaConfigured={config?.alpaca_configured ?? true}
              runCount={runs.length}
              onDone={handleStep3Done}
            />
            <Step4Results
              state={s4}
              result={backtestResult}
              runs={runs}
              activeRun={activeRun}
              onSelectRun={handleSelectRun}
              paperId={paperId}
            />
          </div>
        </main>
      </div>
    </>
  )
}
