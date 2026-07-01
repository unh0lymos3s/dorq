import { useCallback, useEffect, useState } from 'react'
import type { StrategySpec, PortfolioConfig, BacktestResult, ServerConfig } from './types'
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
  const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(null)

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

  const handleStep3Done = useCallback((result: BacktestResult) => setBacktestResult(result), [])

  const hasStrategy = strategySpec !== null || strategyCode !== null

  // Stage states drive the pipeline spine.
  const s1: 'idle' | 'active' | 'done' = paperId ? 'done' : 'active'
  const s2: 'idle' | 'active' | 'done' = hasStrategy ? 'done' : paperId ? 'active' : 'idle'
  const s3: 'idle' | 'active' | 'done' = backtestResult ? 'done' : hasStrategy ? 'active' : 'idle'
  const s4: 'idle' | 'active' | 'done' = backtestResult ? 'active' : 'idle'

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><span className="brand-mark" />dorq</div>
        <nav className="crumbs" aria-label="Pipeline">
          <b>Research</b><span className="sep">→</span><b>Strategy</b><span className="sep">→</span><b>Backtest</b>
        </nav>
        <div className="topbar-right">
          {config && (
            <span className="status-pill" title="Local model serving this app">
              <span className={`dot${config.alpaca_configured ? '' : ' off'}`} />
              {config.ollama_model} · ollama
            </span>
          )}
          <button className="icon-btn" onClick={toggleTheme} aria-label="Toggle theme">
            {light ? MOON : SUN}
          </button>
        </div>
      </header>

      <main className="stage-wrap">
        <section className="hero">
          <div className="eyebrow">Research → Strategy → Backtest</div>
          <h1>Turn a paper into a <span className="grad">running backtest.</span></h1>
          <p>
            Drop in a research paper. A local model reads it, distills a tradeable
            strategy, and runs it against real market data — all on your machine.
          </p>
        </section>

        <div className="pipeline">
          <Step1Paper state={s1} onDone={handleStep1Done} />
          <Step2Strategy
            state={s2}
            paperId={paperId}
            model={config?.ollama_model}
            onDone={handleStep2Done}
          />
          <Step3Backtest
            state={s3}
            mode={strategyMode}
            strategySpec={strategySpec}
            portfolioConfig={portfolioConfig}
            strategyCode={strategyCode}
            alpacaConfigured={config?.alpaca_configured ?? true}
            onDone={handleStep3Done}
          />
          <Step4Results state={s4} result={backtestResult} />
        </div>
      </main>
    </div>
  )
}
