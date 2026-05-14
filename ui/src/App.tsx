import { useEffect, useState } from 'react'
import type { StrategySpec, PortfolioConfig, BacktestResult } from './types'
import Step1Paper from './steps/Step1Paper'
import Step2Strategy from './steps/Step2Strategy'
import Step3Backtest from './steps/Step3Backtest'
import Step4Results from './steps/Step4Results'

export default function App() {
  const [dark, setDark] = useState(true)

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)
  const [paperId, setPaperId] = useState<string | null>(null)
  const [strategyMode, setStrategyMode] = useState<'spec' | 'code'>('spec')
  const [strategySpec, setStrategySpec] = useState<StrategySpec | null>(null)
  const [portfolioConfig, setPortfolioConfig] = useState<PortfolioConfig | null>(null)
  const [strategyCode, setStrategyCode] = useState<string | null>(null)
  const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(null)

  useEffect(() => {
    if (dark) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [dark])

  function handleStep1Done(id: string) {
    setPaperId(id)
    setStep(2)
  }

  function handleStep2Done(
    mode: 'spec' | 'code',
    spec: StrategySpec | null,
    config: PortfolioConfig | null,
    code: string | null,
  ) {
    setStrategyMode(mode)
    setStrategySpec(spec)
    setPortfolioConfig(config)
    setStrategyCode(code)
    setStep(3)
  }

  function handleStep3Done(result: BacktestResult) {
    setBacktestResult(result)
    setStep(4)
  }

  return (
    <>
      <button
        onClick={() => setDark(d => !d)}
        style={{
          position: 'fixed',
          top: 20,
          right: 20,
          background: 'transparent',
          border: 'none',
          fontSize: 18,
          cursor: 'pointer',
          color: 'var(--text)',
          padding: 4,
          lineHeight: 1,
          zIndex: 100,
        }}
        aria-label="Toggle theme"
      >
        {dark ? '☀' : '☾'}
      </button>

      <div
        style={{
          maxWidth: 640,
          margin: '0 auto',
          padding: '48px 20px 80px',
        }}
      >
        <div style={{ marginBottom: 32 }}>
          <h1
            style={{
              fontSize: 24,
              fontWeight: 700,
              letterSpacing: '-0.5px',
              margin: 0,
            }}
          >
            dorq
          </h1>
          <p
            style={{
              color: 'var(--muted)',
              fontSize: 13,
              marginTop: 4,
              marginBottom: 0,
            }}
          >
            research paper → trading strategy → backtest
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Step1Paper
            onDone={handleStep1Done}
            done={step > 1}
          />
          <Step2Strategy
            paperId={paperId}
            onDone={handleStep2Done}
            done={step > 2}
            active={step >= 2}
          />
          <Step3Backtest
            mode={strategyMode}
            strategySpec={strategySpec}
            portfolioConfig={portfolioConfig}
            strategyCode={strategyCode}
            onDone={handleStep3Done}
            done={step > 3}
            active={step >= 3}
          />
          <Step4Results
            result={backtestResult}
            active={step >= 4}
          />
        </div>
      </div>
    </>
  )
}
