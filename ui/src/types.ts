export interface PaperResult {
  paper_id: string
  filename?: string
  source_url?: string
  sections_found: string[]
  markdown_length: number
}

export interface RiskParams {
  stop_loss_pct?: number
  take_profit_pct?: number
  max_position_size?: number
}

export interface IndicatorDef {
  name: string
  type: string
  params: Record<string, unknown>
}

export interface StrategySpec {
  title: string
  summary: string
  assets: string[]
  timeframe: string
  date_range: [string, string]
  indicators: IndicatorDef[]
  entry_conditions: string[]
  exit_conditions: string[]
  position_sizing: string
  risk_params: RiskParams
}

export interface PortfolioConfig {
  assets: string[]
  timeframe: string
  date_range: [string, string]
  position_sizing: string
  risk_params: RiskParams
}

export interface CodeStrategyResult {
  strategy_code: string
  portfolio_config: PortfolioConfig
}

export interface BacktestResult {
  backtest_id: string
  metrics: Record<string, number | string | null>
  charts: string[]
}

export type GenerateMode = 'spec' | 'code'

export interface ServerConfig {
  ollama_model: string
  alpaca_configured: boolean
}
