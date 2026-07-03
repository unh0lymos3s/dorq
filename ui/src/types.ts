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
  init_cash: number
}

export interface PortfolioConfig {
  assets: string[]
  timeframe: string
  date_range: [string, string]
  position_sizing: string
  risk_params: RiskParams
  init_cash: number
}

export interface CodeStrategyResult {
  strategy_code: string
  portfolio_config: PortfolioConfig
}

export interface PricePoint {
  t: string
  c: number
}

export interface TradeMarker {
  asset: string
  side: 'long' | 'short'
  status: 'open' | 'closed'
  entry_time: string
  entry_price: number
  exit_time: string | null
  exit_price: number | null
  pnl: number | null
  return_pct: number | null
}

export interface BacktestResult {
  backtest_id: string
  metrics: Record<string, number | string | null>
  charts: string[]
  price_series?: Record<string, PricePoint[]>
  trades?: TradeMarker[]
}

export type GenerateMode = 'spec' | 'code'

export interface ServerConfig {
  ollama_model: string
  alpaca_configured: boolean
}
